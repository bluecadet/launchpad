import { err, errAsync, ok, Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import type {
	DestinationContext,
	DestinationExporters,
	ExportFailure,
	ExportResult,
	LogExportContext,
	ObservabilityDestination,
	ResourceAttributes,
} from "../core/destination.js";
import { DestinationFailure } from "../core/export-failure.js";
import type { LogEntry } from "../core/log-entry.js";
import { createStructuredLog, serializeStructuredLog } from "../core/structured-log.js";

const lokiAuthSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("basic"),
		username: z.string(),
		password: z.string(),
	}),
	z.object({
		type: z.literal("bearer"),
		token: z.string(),
	}),
]);

const DEFAULT_RESOURCE_LABELS: Readonly<Record<string, string>> = {
	"service.name": "service_name",
};
const MAX_RESOURCE_LABELS = 64;
const MAX_RESOURCE_LABEL_LENGTH = 128;
const LOKI_LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;
const RESERVED_LOG_LABELS = new Set(["level", "module", "event"]);

const resourceLabelsSchema = z.record(z.string(), z.string()).superRefine((mapping, context) => {
	const entries = Object.entries(mapping);
	if (entries.length > MAX_RESOURCE_LABELS) {
		context.addIssue({
			code: "custom",
			message: `Resource label mappings must contain at most ${MAX_RESOURCE_LABELS} entries`,
		});
	}

	const targets = new Set<string>();
	for (const [attribute, label] of entries) {
		if (attribute.trim().length === 0 || attribute.length > MAX_RESOURCE_LABEL_LENGTH) {
			context.addIssue({
				code: "custom",
				path: [attribute],
				message: `Resource attribute keys must be nonblank and at most ${MAX_RESOURCE_LABEL_LENGTH} characters`,
			});
		}
		if (label.length > MAX_RESOURCE_LABEL_LENGTH || !LOKI_LABEL_NAME.test(label)) {
			context.addIssue({
				code: "custom",
				path: [attribute],
				message: `Loki label names must match ${LOKI_LABEL_NAME} and be at most ${MAX_RESOURCE_LABEL_LENGTH} characters`,
			});
		}
		if (label.startsWith("__")) {
			context.addIssue({
				code: "custom",
				path: [attribute],
				message: "Loki label names beginning with '__' are reserved for internal use",
			});
		}
		if (RESERVED_LOG_LABELS.has(label)) {
			context.addIssue({
				code: "custom",
				path: [attribute],
				message: "Resource labels must not target level, module, or event",
			});
		}
		if (targets.has(label)) {
			context.addIssue({
				code: "custom",
				path: [attribute],
				message: "Resource label mappings must not contain duplicate target names",
			});
		}
		targets.add(label);
	}
});

const resourceLabelsInputSchema = z
	.unknown()
	.superRefine((mapping, context) => {
		if (typeof mapping === "object" && mapping !== null && Object.hasOwn(mapping, "__proto__")) {
			context.addIssue({
				code: "custom",
				path: ["__proto__"],
				message: "Resource attribute key '__proto__' is not supported",
			});
		}
	})
	.pipe(resourceLabelsSchema);

export const lokiDestinationConfigSchema = z
	.object({
		/** Destination name used by delivery state and diagnostics. */
		name: z.string().trim().min(1).default("loki"),
		/** Base Loki URL. `/loki/api/v1/push` is appended automatically. */
		url: z
			.string()
			.trim()
			.min(1)
			.refine((value) => {
				const url = URL.parse(value);
				return (
					url !== null &&
					(url.protocol === "http:" || url.protocol === "https:") &&
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash
				);
			}, "Loki URL must use HTTP(S) without credentials, query, or fragment"),
		/** Optional authentication configuration. */
		auth: lokiAuthSchema.optional(),
		/** Optional proxy, gateway, or tenant headers. */
		headers: z.record(z.string(), z.string()).optional(),
		/** Resource attribute key to Loki label name mappings. Replaces the default when supplied. */
		resourceLabels: resourceLabelsInputSchema.default(DEFAULT_RESOURCE_LABELS),
	})
	.refine(
		(config) =>
			Result.fromThrowable(
				() => {
					const headers = new Headers(config.headers);
					if (config.auth) headers.set("Authorization", authorizationHeader(config.auth));
				},
				() => false,
			)().isOk(),
		"Loki headers must be valid",
	);

type LokiDestinationConfigInput = z.input<typeof lokiDestinationConfigSchema>;
export type LokiDestinationConfig = Omit<LokiDestinationConfigInput, "resourceLabels"> & {
	readonly resourceLabels?: Readonly<Record<string, string>>;
};
export type ResolvedLokiDestinationConfig = z.output<typeof lokiDestinationConfigSchema>;
export type LokiDestinationAuth = z.infer<typeof lokiAuthSchema>;

type LokiStream = {
	readonly stream: Readonly<Record<string, string>>;
	readonly values: [string, string][];
};

type LokiPushPayload = {
	readonly streams: readonly LokiStream[];
};

function toNanosecondTimestamp(timestamp: Date): string {
	return `${timestamp.getTime()}000000`;
}

function stringResourceAttribute(
	resourceAttributes: ResourceAttributes,
	key: string,
): string | undefined {
	if (!Object.hasOwn(resourceAttributes, key)) return undefined;

	const value: unknown = resourceAttributes[key];
	if (typeof value === "string" || typeof value === "boolean") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function streamLabels(
	entry: LogEntry,
	resourceAttributes: ResourceAttributes,
	resourceLabels: Readonly<Record<string, string>>,
): Record<string, string> {
	const labels: Record<string, string> = { level: entry.level };

	for (const [attribute, label] of Object.entries(resourceLabels)) {
		const value = stringResourceAttribute(resourceAttributes, attribute);
		if (value !== undefined) labels[label] = value;
	}

	if (entry.module !== undefined) labels.module = entry.module;
	if (entry.level === "event") labels.event = entry.event;
	return labels;
}

function labelsKey(labels: Readonly<Record<string, string>>): string {
	return JSON.stringify(
		Object.entries(labels).sort(([first], [second]) => first.localeCompare(second)),
	);
}

function buildLokiPayload(
	records: readonly LogEntry[],
	resourceAttributes: ResourceAttributes,
	resourceLabels: Readonly<Record<string, string>>,
): Result<LokiPushPayload, ExportFailure> {
	const streams = new Map<string, LokiStream>();

	for (const record of records) {
		const labels = streamLabels(record, resourceAttributes, resourceLabels);
		const key = labelsKey(labels);
		let stream = streams.get(key);
		if (!stream) {
			stream = { stream: labels, values: [] };
			streams.set(key, stream);
		}
		const line = createStructuredLog(record, resourceAttributes).andThen((log) =>
			serializeStructuredLog(log),
		);
		if (line.isErr()) return err(line.error);
		stream.values.push([toNanosecondTimestamp(record.timestamp), line.value]);
	}

	for (const stream of streams.values()) {
		stream.values.sort(([first], [second]) => {
			const firstTimestamp = BigInt(first);
			const secondTimestamp = BigInt(second);
			return firstTimestamp < secondTimestamp ? -1 : firstTimestamp > secondTimestamp ? 1 : 0;
		});
	}
	return ok({ streams: [...streams.values()] });
}

function authorizationHeader(auth: LokiDestinationAuth): string {
	if (auth.type === "basic") {
		const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
		return `Basic ${credentials}`;
	}
	return `Bearer ${auth.token}`;
}

function retryAfterMilliseconds(response: Response): number | undefined {
	let retryAfter: string | null;
	try {
		retryAfter = response.headers.get("retry-after");
	} catch {
		return undefined;
	}
	if (retryAfter === null) return undefined;

	const seconds = Number(retryAfter);
	const milliseconds = seconds * 1_000;
	if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;

	const retryAt = Date.parse(retryAfter);
	if (!Number.isFinite(retryAt)) return undefined;
	return Math.max(0, retryAt - Date.now());
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

function cancelResponseBody(response: Response): ResultAsync<void, never> {
	return ResultAsync.fromPromise(
		Promise.resolve().then(() => response.body?.cancel()),
		() => undefined,
	).orElse(() => ok(undefined));
}

function httpFailure(response: Response): ExportFailure {
	const retryable = isRetryableStatus(response.status);
	const retryAfterMs = retryable ? retryAfterMilliseconds(response) : undefined;
	return new DestinationFailure(`Loki export failed with HTTP ${response.status}`, {
		retryable,
		retryAfterMs,
	});
}

function fetchFailure(value: unknown, signal: AbortSignal): ExportFailure {
	let abortError = false;
	try {
		abortError = value instanceof Error && value.name === "AbortError";
	} catch {
		// A library rejection can contain an unreadable thrown value.
	}
	return new DestinationFailure(
		signal.aborted || abortError ? "Loki export was aborted" : "Loki request failed",
		{ retryable: !signal.aborted && !abortError },
	);
}

function exportRecords(
	pushUrl: string,
	resolved: ResolvedLokiDestinationConfig,
	factoryResourceAttributes: ResourceAttributes,
	records: readonly LogEntry[],
	context: LogExportContext,
): ResultAsync<ExportResult, ExportFailure> {
	if (context.signal.aborted)
		return errAsync(new DestinationFailure("Loki export was aborted", { retryable: false }));

	const resourceAttributes = context.resourceAttributes ?? factoryResourceAttributes;
	const body = buildLokiPayload(records, resourceAttributes, resolved.resourceLabels).andThen(
		(payload) =>
			Result.fromThrowable(
				() => JSON.stringify(payload),
				() => new DestinationFailure("Loki payload serialization failed", { retryable: false }),
			)(),
	);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...resolved.headers,
	};
	if (resolved.auth) headers.Authorization = authorizationHeader(resolved.auth);

	return body.asyncAndThen((encoded) =>
		ResultAsync.fromPromise(
			Promise.resolve().then(() =>
				fetch(pushUrl, {
					method: "POST",
					headers,
					body: encoded,
					signal: context.signal,
				}),
			),
			(error) => fetchFailure(error, context.signal),
		).andThen((response) =>
			cancelResponseBody(response).andThen(() =>
				!response.ok || response.status === 260
					? err(httpFailure(response))
					: ok({ rejectedRecords: 0 }),
			),
		),
	);
}

function parseConfig(
	config: LokiDestinationConfig,
): Result<ResolvedLokiDestinationConfig, ExportFailure> {
	const result = lokiDestinationConfigSchema.safeParse(config);
	if (result.success) return ok(result.data);
	return err(
		new DestinationFailure("Invalid Loki destination configuration", { retryable: false }),
	);
}

/** Derive checkpoint identity without throwing or validating the rest of the config. */
function normalizeEndpoint(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const endpoint = URL.parse(value);
	if (
		!endpoint ||
		(endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		return undefined;
	endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
	return endpoint.toString();
}

/**
 * Configure structured log export through Loki's HTTP push API.
 *
 * The factory is inert: create() validates configuration and returns a sanitized
 * error Result for invalid options. Neither phase performs network requests.
 * Each export is one HTTP request; retry policy belongs to the delivery loop.
 */
export function createLokiDestination(config: LokiDestinationConfig): ObservabilityDestination {
	const endpoint = normalizeEndpoint(config?.url);
	return {
		name: typeof config?.name === "string" ? config.name.trim() : "loki",
		checkpointKey: endpoint === undefined ? undefined : `loki:${endpoint}`,
		create(context: DestinationContext) {
			const result = parseConfig(config);
			if (result.isErr()) return err(result.error);
			const resolved = result.value;
			const endpoint = normalizeEndpoint(resolved.url);
			if (endpoint === undefined) {
				return err(
					new DestinationFailure("Invalid Loki destination configuration", { retryable: false }),
				);
			}
			const pushUrl = `${endpoint.replace(/\/$/, "")}/loki/api/v1/push`;
			if (!context.resourceAttributes) {
				return err(
					new DestinationFailure("Loki destination requires resource attributes", {
						retryable: false,
					}),
				);
			}

			const exporters: DestinationExporters = {
				logs: {
					supportsResourceContext: true,
					export(records, exportContext) {
						return exportRecords(
							pushUrl,
							resolved,
							context.resourceAttributes,
							records,
							exportContext,
						);
					},
				},
			};
			return ok(exporters);
		},
	};
}
