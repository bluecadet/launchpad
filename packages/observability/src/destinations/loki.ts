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

export const lokiDestinationConfigSchema = z.object({
	/** Destination name used by delivery state and diagnostics. */
	name: z.string().trim().min(1).default("loki"),
	/** Base Loki URL. `/loki/api/v1/push` is appended automatically. */
	url: z.string().trim().min(1),
	/** Optional authentication configuration. */
	auth: lokiAuthSchema.optional(),
	/** Optional proxy, gateway, or tenant headers. */
	headers: z.record(z.string(), z.string()).optional(),
	/** Resource attribute key to Loki label name mappings. Replaces the default when supplied. */
	resourceLabels: resourceLabelsInputSchema.default(DEFAULT_RESOURCE_LABELS),
});

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
): LokiPushPayload {
	const streams = new Map<string, LokiStream>();

	for (const record of records) {
		const labels = streamLabels(record, resourceAttributes, resourceLabels);
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
		body = JSON.stringify(buildLokiPayload(records, resourceAttributes, resolved.resourceLabels));
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
