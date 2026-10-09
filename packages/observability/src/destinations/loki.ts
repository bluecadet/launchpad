import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import type {
	DestinationContext,
	DestinationExporters,
	ExportContext,
	ExportFailure,
	ExportResult,
	ObservabilityDestination,
	ResourceAttributes,
} from "../core/destination.js";
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

export const lokiDestinationConfigSchema = z.object({
	/** Destination name used by delivery state and diagnostics. */
	name: z.string().trim().min(1).default("loki"),
	/** Base Loki URL. `/loki/api/v1/push` is appended automatically. */
	url: z.string().trim().min(1),
	/** Optional authentication configuration. */
	auth: lokiAuthSchema.optional(),
	/** Optional proxy, gateway, or tenant headers. */
	headers: z.record(z.string(), z.string()).optional(),
});

export type LokiDestinationConfig = z.input<typeof lokiDestinationConfigSchema>;
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
	const value = resourceAttributes[key];
	return value === undefined ? undefined : String(value);
}

function streamLabels(
	entry: LogEntry,
	resourceAttributes: ResourceAttributes,
): Record<string, string> {
	const labels: Record<string, string> = { level: entry.level };
	const resourceLabelKeys = [
		["service_name", "service.name"],
		["client", "launchpad.client"],
		["project", "launchpad.project"],
		["installation", "launchpad.installation"],
		["environment", "deployment.environment.name"],
	] as const;

	for (const [label, attribute] of resourceLabelKeys) {
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
): LokiPushPayload {
	const streams = new Map<string, LokiStream>();

	for (const record of records) {
		const labels = streamLabels(record, resourceAttributes);
		const key = labelsKey(labels);
		let stream = streams.get(key);
		if (!stream) {
			stream = { stream: labels, values: [] };
			streams.set(key, stream);
		}
		stream.values.push([
			toNanosecondTimestamp(record.timestamp),
			serializeStructuredLog(createStructuredLog(record, resourceAttributes)),
		]);
	}

	for (const stream of streams.values()) {
		stream.values.sort(([first], [second]) => {
			const firstTimestamp = BigInt(first);
			const secondTimestamp = BigInt(second);
			return firstTimestamp < secondTimestamp ? -1 : firstTimestamp > secondTimestamp ? 1 : 0;
		});
	}
	return { streams: [...streams.values()] };
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

function cancelResponseBody(response: Response): void {
	try {
		void response.body?.cancel().catch(() => undefined);
	} catch {
		// A locked or unusual response body should not replace the HTTP failure.
	}
}

function httpFailure(response: Response): ExportFailure {
	const retryable = isRetryableStatus(response.status);
	const retryAfterMs = retryable ? retryAfterMilliseconds(response) : undefined;
	const error = new Error(`Loki export failed with HTTP ${response.status}`);
	return Object.assign(
		error,
		retryAfterMs === undefined ? { retryable } : { retryable, retryAfterMs },
	);
}

function exportFailure(value: unknown): ExportFailure {
	try {
		if (value instanceof Error) {
			const retryable = Object.getOwnPropertyDescriptor(value, "retryable")?.value;
			if (typeof retryable === "boolean") return value;
		}
	} catch {
		// Sanitize unreadable thrown values below.
	}
	return Object.assign(new Error("Loki export failed"), { retryable: true });
}

function fetchFailure(value: unknown, signal: AbortSignal): ExportFailure {
	let abortError = false;
	try {
		abortError = value instanceof Error && value.name === "AbortError";
	} catch {
		// Treat unreadable thrown values as transient without exposing their contents.
	}
	return Object.assign(
		new Error(signal.aborted || abortError ? "Loki export was aborted" : "Loki request failed"),
		{
			retryable: !signal.aborted && !abortError,
		},
	);
}

function abortedFailure(): ExportFailure {
	return Object.assign(new Error("Loki export was aborted"), { retryable: false });
}

async function exportRecords(
	pushUrl: string,
	resolved: ResolvedLokiDestinationConfig,
	resourceAttributes: ResourceAttributes,
	records: readonly LogEntry[],
	context: ExportContext,
): Promise<ExportResult> {
	if (context.signal.aborted) throw abortedFailure();

	let body: string;
	try {
		body = JSON.stringify(buildLokiPayload(records, resourceAttributes));
	} catch {
		throw Object.assign(new Error("Loki payload serialization failed"), { retryable: false });
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...resolved.headers,
	};
	if (resolved.auth) headers.Authorization = authorizationHeader(resolved.auth);

	let response: Response;
	try {
		response = await fetch(pushUrl, {
			method: "POST",
			headers,
			body,
			signal: context.signal,
		});
	} catch (error) {
		throw fetchFailure(error, context.signal);
	}

	if (!response.ok || response.status === 260) {
		cancelResponseBody(response);
		throw httpFailure(response);
	}
	cancelResponseBody(response);
	return { rejectedRecords: 0 };
}

function parseConfig(config: LokiDestinationConfig): ResolvedLokiDestinationConfig {
	const result = lokiDestinationConfigSchema.safeParse(config);
	if (result.success) return result.data;
	// Zod issues report field paths and constraints without echoing credential values.
	throw new Error("Invalid Loki destination configuration", { cause: result.error });
}

/**
 * Configure structured log export through Loki's HTTP push API.
 *
 * Creating the destination and its exporter is network-inert. Each export is a
 * single HTTP request; retry policy belongs to the observability delivery loop.
 */
export function createLokiDestination(config: LokiDestinationConfig): ObservabilityDestination {
	const resolved = parseConfig(config);
	const pushUrl = `${resolved.url.replace(/\/$/, "")}/loki/api/v1/push`;

	return {
		name: resolved.name,
		create(context: DestinationContext) {
			if (!context.resourceAttributes) {
				return err(
					Object.assign(new Error("Loki destination requires resource attributes"), {
						retryable: false,
					}),
				);
			}

			const exporters: DestinationExporters = {
				logs: {
					export(records, exportContext) {
						return ResultAsync.fromPromise(
							exportRecords(pushUrl, resolved, context.resourceAttributes, records, exportContext),
							exportFailure,
						);
					},
				},
			};
			return ok(exporters);
		},
	};
}
