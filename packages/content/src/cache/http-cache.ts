import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import CachePolicy from "http-cache-semantics";
import { z } from "zod";
import { safeKy } from "../utils/safe-ky.js";
import type { ArtifactCacheCapability, HttpArtifact, JsonValue } from "./artifact-cache.js";

const POLICY_OPTIONS = { shared: false, cacheHeuristic: 0, immutableMinTimeToLive: 0 };
const CACHE_HEADERS = [
	"cache-control",
	"date",
	"age",
	"expires",
	"etag",
	"last-modified",
	"vary",
	"pragma",
];
const headersSchema = z.record(z.string(), z.string());
const directivesSchema = z.record(z.string(), z.union([z.string(), z.boolean()]));
const serializedPolicySchema = z.object({
	v: z.literal(1),
	t: z.number(),
	sh: z.literal(false),
	ch: z.literal(0),
	imm: z.literal(0),
	st: z.number(),
	resh: headersSchema,
	rescc: directivesSchema,
	m: z.literal("GET"),
	u: z.string(),
	h: z.string().optional(),
	a: z.boolean(),
	reqh: headersSchema.nullable(),
	reqcc: directivesSchema,
});
const metadataSchema = z.object({
	version: z.literal(1),
	requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	policy: serializedPolicySchema,
});

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** The library parses directive names case-sensitively; HTTP does not. */
function normalizeCacheControl(value: string, requestPolicy = false): string {
	const parts: string[] = [];
	let start = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && character === "\\") escaped = true;
		else if (character === '"') quoted = !quoted;
		else if (!quoted && character === ",") {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));
	const seenDeltaSeconds = new Set<string>();
	const invalidDeltaSeconds = new Set<string>();
	const normalized = parts.map((part) => {
		const separator = part.indexOf("=");
		const name = (separator === -1 ? part : part.slice(0, separator)).trim().toLowerCase();
		const argument = separator === -1 ? "" : part.slice(separator);
		if (
			[
				"max-age",
				"s-maxage",
				"stale-if-error",
				"stale-while-revalidate",
				"min-fresh",
				"max-stale",
			].includes(name)
		) {
			const delta = /^=\s*(?:"(\d+)"|(\d+))\s*$/.exec(argument);
			if (
				seenDeltaSeconds.has(name) ||
				(!(name === "max-stale" && separator === -1) &&
					(!delta || !Number.isSafeInteger(Number(delta[1] ?? delta[2]))))
			)
				invalidDeltaSeconds.add(name);
			seenDeltaSeconds.add(name);
		}
		if (separator === -1) return name;
		// The upstream parser also splits commas inside quoted values. Field-list
		// restrictions can safely become bare restrictions; other comma-valued
		// extensions must not inject apparent freshness directives.
		if (argument.includes(",")) {
			return ["no-cache", "no-store", "private", "must-revalidate"].includes(name) ? name : "";
		}
		return name + argument;
	});
	// Invalid/duplicate delta-seconds cannot grant freshness or stale extensions.
	return normalized
		.filter((part) => !invalidDeltaSeconds.has(part.split("=", 1)[0]?.trim() ?? ""))
		.concat([...invalidDeltaSeconds].map((name) => `${name}=0`))
		.concat(requestPolicy && invalidDeltaSeconds.size ? ["no-cache"] : [])
		.join(", ");
}

function requestForPolicy(url: string, headers: Headers): CachePolicy.Request {
	const privateHeaders: Record<string, string> = {};
	for (const [name, value] of headers) {
		privateHeaders[name] =
			name === "cache-control"
				? normalizeCacheControl(value, true)
				: name === "pragma"
					? value.toLowerCase()
					: digest(value);
	}
	return { url: digest(url), method: "GET", headers: privateHeaders };
}

/** Actual representation identity must not use the library's lossy directive normalization. */
function requestKey(url: string, headers: Headers): string {
	const privateHeaders = Array.from(headers, ([name, value]) => [name, digest(value)]).sort();
	return digest(JSON.stringify([digest(url), "GET", privateHeaders]));
}

function responseForPolicy(response: { status: number; headers: Headers }): CachePolicy.Response {
	const headers: Record<string, string> = {};
	for (const name of CACHE_HEADERS) {
		const value = response.headers.get(name);
		if (value !== null)
			headers[name] =
				name === "cache-control"
					? normalizeCacheControl(value)
					: name === "pragma"
						? value.toLowerCase()
						: value;
	}
	// 4.2.x counts Age + resident time, but omits apparent age from Date.
	const serverDate = Date.parse(headers.date ?? "");
	const apparentAge = Number.isFinite(serverDate)
		? Math.max(0, (Date.now() - serverDate) / 1000)
		: 0;
	headers.age = String(Math.max(Number(headers.age) || 0, apparentAge));
	return { status: response.status, headers };
}

/** Private HTTP policy. Only explicit server freshness can avoid a network request. */
export class HttpCachePolicy {
	private constructor(
		private readonly policy: CachePolicy,
		private readonly identity: string,
	) {}

	static create(
		url: string,
		headers: Headers,
		response: { status: number; headers: Headers },
	): HttpCachePolicy {
		const request = requestForPolicy(url, headers);
		return new HttpCachePolicy(
			new CachePolicy(request, responseForPolicy(response), POLICY_OPTIONS),
			requestKey(url, headers),
		);
	}

	static restore(metadata: JsonValue): HttpCachePolicy | undefined {
		const parsed = metadataSchema.safeParse(metadata);
		if (!parsed.success) return undefined;
		try {
			// The upstream types omit boolean Cache-Control directives present in serialized policies.
			const serialized = parsed.data.policy as unknown as CachePolicy.CachePolicyObject;
			return new HttpCachePolicy(
				CachePolicy.fromObject(serialized),
				parsed.data.requestFingerprint,
			);
		} catch {
			return undefined;
		}
	}

	private matches(url: string, headers: Headers): boolean {
		const serialized = this.policy.toObject();
		const request = requestForPolicy(url, headers);
		const vary = serialized.resh.vary;
		if (!this.policy.storable() || typeof vary === "object") return false;
		const varyingHeaders = vary?.split(",").map((name) => name.trim().toLowerCase()) ?? [];
		return (
			!varyingHeaders.includes("*") &&
			serialized.u === request.url &&
			serialized.m === request.method &&
			serialized.h === request.headers.host &&
			varyingHeaders.every((name) => serialized.reqh?.[name] === request.headers[name]) &&
			this.identity === requestKey(url, headers)
		);
	}

	fresh(url: string, headers: Headers): boolean {
		if (!this.matches(url, headers) || this.policy.stale()) return false;
		// 4.2.x revalidates even fresh must-revalidate entries. RFC 9111 restricts
		// stale reuse only; keep all request-side/no-cache checks in the library.
		const serialized = this.policy.toObject();
		const directives = { ...serialized.rescc };
		delete directives["must-revalidate"];
		const freshPolicy = CachePolicy.fromObject({ ...serialized, rescc: directives });
		return freshPolicy.satisfiesWithoutRevalidation(requestForPolicy(url, headers));
	}

	conditionalHeaders(url: string, headers: Headers): Headers {
		const result = new Headers(headers);
		if (!this.matches(url, headers)) return result;
		const validators = this.policy.revalidationHeaders(requestForPolicy(url, headers));
		for (const name of ["if-none-match", "if-modified-since"]) {
			const value = validators[name];
			if (typeof value === "string") result.set(name, value);
		}
		return result;
	}

	revalidate(
		url: string,
		headers: Headers,
		response: { status: number; headers: Headers },
	): HttpCachePolicy | undefined {
		if (response.status !== 304 || !this.matches(url, headers)) return undefined;
		const incoming = responseForPolicy(response);
		const result = this.policy.revalidatedPolicy(requestForPolicy(url, headers), incoming);
		// modified alone is unsafe: the library also returns false for mismatched 304s.
		if (!result.matches || result.modified) return undefined;
		// 4.2.x merges only existing header names; include newly introduced 304 cache headers.
		const serialized = result.policy.toObject();
		const merged = { ...serialized.resh, ...incoming.headers };
		return new HttpCachePolicy(
			new CachePolicy(
				requestForPolicy(url, headers),
				{ status: serialized.st, headers: merged },
				POLICY_OPTIONS,
			),
			this.identity,
		);
	}

	allowsStaleOnError(url: string, headers: Headers, status: number): boolean {
		if (![500, 502, 503, 504].includes(status) || !this.matches(url, headers)) return false;
		const serialized = this.policy.toObject();
		const directives = serialized.rescc;
		if (
			directives["must-revalidate"] ||
			directives["no-cache"] ||
			serialized.reqcc["no-cache"] ||
			serialized.reqcc["no-store"]
		)
			return false;
		const value = directives["stale-if-error"];
		if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
		const allowance = Number(value);
		return (
			Number.isSafeInteger(allowance) &&
			allowance > 0 &&
			this.policy.age() < this.policy.maxAge() + allowance
		);
	}

	serialize(): JsonValue {
		if (
			!this.policy.storable() ||
			this.policy
				.toObject()
				.resh.vary?.toString()
				.split(",")
				.some((name) => name.trim() === "*")
		)
			return null;
		return z.json().parse(
			JSON.parse(
				JSON.stringify({
					version: 1,
					requestFingerprint: this.identity,
					policy: this.policy.toObject(),
				}),
			),
		);
	}
}

export type HttpDownloadOptions = {
	cache: ArtifactCacheCapability;
	sourceId: string;
	outputPath: string;
	url: string;
	signal: AbortSignal;
	timeout: number;
	ignoreCache?: boolean;
	headers?: Headers;
};

class HttpDownloadError extends Error {
	constructor(
		readonly kind: "network" | "filesystem",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = kind === "network" ? "NetworkError" : "FileSystemError";
	}
}

type DownloadResult = { cacheHit: boolean };
type InFlightDownload = { bypass: boolean; promise: Promise<DownloadResult> };
const inFlight = new WeakMap<ArtifactCacheCapability, Map<string, InFlightDownload>>();

/** Download or restore trusted bytes directly into this run's staged output. */
export async function downloadHttpArtifact(options: HttpDownloadOptions): Promise<DownloadResult> {
	const headers = new Headers(options.headers ?? { accept: "*/*", "accept-encoding": "identity" });
	const artifact: HttpArtifact = {
		sourceId: options.sourceId,
		outputPath: options.outputPath,
		key: digest(JSON.stringify(["http-v1", requestKey(options.url, headers), options.outputPath])),
	};
	let work = inFlight.get(options.cache);
	if (!work) {
		work = new Map();
		inFlight.set(options.cache, work);
	}
	const identity = JSON.stringify([artifact.sourceId, artifact.key]);
	const bypass = Boolean(options.ignoreCache);
	const existing = work.get(identity);
	if (existing && existing.bypass === bypass) return existing.promise;
	// A bypass must still issue its GET, but must not race a restore of the same output.
	const operation = existing
		? existing.promise.then(
				() => performDownload(options, headers, artifact),
				() => performDownload(options, headers, artifact),
			)
		: performDownload(options, headers, artifact);
	work.set(identity, { bypass, promise: operation });
	try {
		return await operation;
	} finally {
		if (work.get(identity)?.promise === operation) work.delete(identity);
	}
}

async function performDownload(
	options: HttpDownloadOptions,
	headers: Headers,
	artifact: HttpArtifact,
): Promise<DownloadResult> {
	// Claims precede writes, including cache bypasses and non-storable responses.
	const filePath = await options.cache.claimHttp(artifact);
	options.signal.throwIfAborted();
	const cached = options.ignoreCache ? undefined : await options.cache.lookupHttp(artifact);
	const policy = cached ? HttpCachePolicy.restore(cached.record.metadata) : undefined;
	if (policy?.fresh(options.url, headers) && (await reuse(options, artifact)))
		return { cacheHit: true };

	const conditional = policy?.conditionalHeaders(options.url, headers) ?? headers;
	let response: Awaited<ReturnType<typeof request>>;
	try {
		response = await request(options, conditional);
	} catch (error) {
		options.signal.throwIfAborted();
		if (
			isTransportError(error) &&
			policy?.allowsStaleOnError(options.url, headers, 503) &&
			(await reuse(options, artifact))
		)
			return { cacheHit: true };
		throw error;
	}
	try {
		let permitStale = true;
		options.signal.throwIfAborted();
		if (response.status === 304) {
			const validated = policy?.revalidate(options.url, headers, response);
			const sentValidator =
				conditional.has("if-none-match") || conditional.has("if-modified-since");
			if (validated && sentValidator && (await reuse(options, artifact))) {
				await options.cache.storeHttp({ ...artifact, metadata: validated.serialize() });
				return { cacheHit: true };
			}
			permitStale = false;
			discardResponseBody(response);
			response = await request(options, headers);
		}
		if (
			permitStale &&
			policy?.allowsStaleOnError(options.url, headers, response.status) &&
			(await reuse(options, artifact))
		)
			return { cacheHit: true };
		return await writeResponse(options, headers, artifact, response, filePath);
	} finally {
		discardResponseBody(response);
	}
}

async function writeResponse(
	options: HttpDownloadOptions,
	headers: Headers,
	artifact: HttpArtifact,
	response: Awaited<ReturnType<typeof request>>,
	filePath: string,
): Promise<DownloadResult> {
	if (!response.ok || response.status === 206 || !response.body)
		throw new HttpDownloadError("network", `Media GET failed (HTTP ${response.status})`);
	// Start resident time at header receipt, not after a potentially slow body transfer.
	const responsePolicy = HttpCachePolicy.create(options.url, headers, response);
	try {
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await pipeline(response.body, fs.createWriteStream(filePath), {
			signal: options.signal,
		});
	} catch (cause) {
		try {
			await fs.promises.rm(filePath, { force: true });
		} catch {
			// Preserve the original filesystem failure when cleanup also fails.
		}
		throw new HttpDownloadError("filesystem", "Failed to write downloaded media", { cause });
	}
	options.signal.throwIfAborted();
	await options.cache.storeHttp({ ...artifact, metadata: responsePolicy.serialize() });
	return { cacheHit: false };
}

function discardResponseBody(response: Pick<Awaited<ReturnType<typeof request>>, "body">): void {
	if (!response.body || response.body.locked) return;
	// Cancellation starts immediately. Its promise can wait for unrelated consumers
	// of a tee'd response, which this downloader does not own.
	void response.body.cancel().catch(() => {
		// Cleanup must not replace a download failure or a successful stale fallback.
	});
}

async function request(options: HttpDownloadOptions, headers: Headers) {
	const result = await safeKy(options.url, {
		headers,
		signal: options.signal,
		timeout: options.timeout,
		throwHttpErrors: false,
	});
	if (result.isErr())
		throw new HttpDownloadError("network", "Media GET failed", { cause: result.error });
	return result.value;
}

async function reuse(options: HttpDownloadOptions, artifact: HttpArtifact): Promise<boolean> {
	options.signal.throwIfAborted();
	const restored = await options.cache.reuseHttp(artifact);
	options.signal.throwIfAborted();
	return restored;
}

function isTransportError(error: unknown): boolean {
	if (!(error instanceof HttpDownloadError) || !(error.cause instanceof Error)) return false;
	const cause = error.cause.cause;
	// safeKy wraps Ky's request errors. Restrict fallback to recognized transport
	// failures, not arbitrary exceptions from hooks, parsing or the filesystem.
	return (
		cause instanceof Error &&
		"request" in cause &&
		cause.request instanceof Request &&
		(cause.name === "NetworkError" || cause.name === "TimeoutError")
	);
}
