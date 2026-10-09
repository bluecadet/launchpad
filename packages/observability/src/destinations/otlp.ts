import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import type {
	DestinationContext,
	DestinationExporters,
	ExportContext,
	ExportFailure,
	ExportResult,
	MetricBatch,
	ObservabilityDestination,
	ResourceAttributeValue,
} from "../core/destination.js";
import type { LogEntry, LogLevel } from "../core/log-entry.js";
import { decodeOtlpProtobufResponse, encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";
import { normalizeStructuredValue, type StructuredValue } from "../core/structured-log.js";

const INSTRUMENTATION_SCOPE_NAME = "@bluecadet/launchpad-observability";
const DEFAULT_SIGNALS = ["logs", "metrics"] as const;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const FAILURE_MARKER = Symbol("otlp-export-failure");

export type OtlpSignal = (typeof DEFAULT_SIGNALS)[number];
export type OtlpEncoding = "json" | "protobuf";

export type OtlpDestinationConfig = {
	/** OTLP/HTTP base URL. Signal paths are appended automatically. */
	readonly endpoint: string;
	readonly name?: string;
	readonly token?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly signals?: readonly OtlpSignal[];
	/** OTLP/HTTP request and response encoding. Defaults to JSON. */
	readonly encoding?: OtlpEncoding;
};

type OtlpAnyValue =
	| { readonly stringValue: string }
	| { readonly boolValue: boolean }
	| { readonly intValue: string }
	| { readonly doubleValue: number }
	| { readonly arrayValue: { readonly values: readonly OtlpAnyValue[] } }
	| {
			readonly kvlistValue: {
				readonly values: readonly OtlpKeyValue[];
			};
	  };

type OtlpKeyValue = {
	readonly key: string;
	readonly value: OtlpAnyValue;
};

type InternalExportFailure = ExportFailure & {
	readonly [FAILURE_MARKER]: true;
};

type ResolvedConfig = {
	readonly name: string;
	readonly logsUrl: string;
	readonly metricsUrl: string;
	readonly headers: Headers;
	readonly signals: ReadonlySet<OtlpSignal>;
	readonly encoding: OtlpEncoding;
};

type MetricGroup = {
	readonly name: string;
	readonly unit?: string;
	readonly description?: string;
	readonly attributeKeys: Set<string>;
	readonly dataPoints: Array<{
		readonly timeUnixNano: string;
		readonly asDouble: number;
		readonly attributes: readonly OtlpKeyValue[];
	}>;
};

/**
 * Creates an SDK-free OTLP/HTTP destination for logs and gauge metrics using native fetch.
 *
 * Configuration is validated by create(), which returns an Err for invalid options.
 * Neither this factory nor create() performs network requests.
 *
 * Severity numbers use the lowest value in each OpenTelemetry range:
 * verbose maps to TRACE (1), debug=DEBUG (5), info/event=INFO (9),
 * warn=WARN (13), and error=ERROR (17). severityText preserves the source level.
 */
export function createOtlpDestination(config: OtlpDestinationConfig): ObservabilityDestination {
	return {
		name: destinationName(config),
		create(context: DestinationContext) {
			const result = resolveConfig(config);
			if (result.isErr()) return err(result.error);
			const resolved = result.value;
			const resource = createResource(context);
			if (!resource) {
				return err(createFailure("OTLP resource attributes are invalid", false));
			}

			const exporters: DestinationExporters = {
				...(resolved.signals.has("logs")
					? {
							logs: {
								export(records: readonly LogEntry[], exportContext: ExportContext) {
									return exportLogs(resolved, resource, records, exportContext);
								},
							},
						}
					: {}),
				...(resolved.signals.has("metrics")
					? {
							metrics: {
								export(batch: MetricBatch, exportContext: ExportContext) {
									return exportMetrics(resolved, resource, batch, exportContext);
								},
							},
						}
					: {}),
			};

			return ok(exporters);
		},
	};
}

const nonblankString = z.string().refine((value) => value.trim().length > 0, "must be nonblank");
const endpointSchema = nonblankString.transform((endpoint, context) => {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		context.addIssue({ code: "custom", message: "must be a valid HTTP(S) URL" });
		return z.NEVER;
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		context.addIssue({ code: "custom", message: "must use HTTP or HTTPS" });
	}
	if (parsed.username || parsed.password) {
		context.addIssue({ code: "custom", message: "must not contain credentials" });
	}
	if (parsed.search || parsed.hash) {
		context.addIssue({ code: "custom", message: "must not contain a query or fragment" });
	}
	return parsed;
});

const otlpDestinationConfigSchema = z
	.object({
		name: nonblankString.default("otlp"),
		endpoint: endpointSchema,
		token: nonblankString.optional(),
		headers: z.record(nonblankString, nonblankString).optional(),
		signals: z
			.array(z.enum(DEFAULT_SIGNALS, { error: "contains an unsupported signal" }))
			.min(1, "must configure at least one signal")
			.refine((signals) => new Set(signals).size === signals.length, "must not contain duplicates")
			.default([...DEFAULT_SIGNALS]),
		encoding: z.enum(["json", "protobuf"], { error: "must be json or protobuf" }).default("json"),
	})
	.superRefine((config, context) => {
		try {
			resolveHeaders(config.headers, config.token, config.encoding);
		} catch {
			context.addIssue({
				code: "custom",
				path: ["headers"],
				message: "headers and token must contain valid nonblank header values",
			});
		}
	});

function resolveConfig(config: OtlpDestinationConfig): Result<ResolvedConfig, ExportFailure> {
	try {
		const result = otlpDestinationConfigSchema.safeParse(config);
		if (!result.success) {
			const details = result.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ");
			return err(createFailure(`Invalid OTLP destination configuration: ${details}`, false));
		}
		const parsed = result.data;
		return ok({
			name: parsed.name,
			logsUrl: appendSignalPath(parsed.endpoint, "/v1/logs"),
			metricsUrl: appendSignalPath(parsed.endpoint, "/v1/metrics"),
			headers: resolveHeaders(parsed.headers, parsed.token, parsed.encoding),
			signals: new Set(parsed.signals),
			encoding: parsed.encoding,
		});
	} catch {
		return err(createFailure("Invalid OTLP destination configuration", false));
	}
}

function appendSignalPath(endpoint: URL, signalPath: string): string {
	const result = new URL(endpoint);
	result.pathname = `${result.pathname.replace(/\/+$/u, "")}${signalPath}`;
	return result.toString();
}

function resolveHeaders(
	headers: Readonly<Record<string, string>> | undefined,
	token: string | undefined,
	encoding: OtlpEncoding,
): Headers {
	const result = new Headers();
	for (const [key, value] of Object.entries(headers ?? {})) result.set(key, value);
	result.set("Content-Type", encoding === "json" ? "application/json" : "application/x-protobuf");
	if (token !== undefined) result.set("Authorization", `Bearer ${token}`);
	return result;
}

function destinationName(config: unknown): string {
	try {
		const result = z.object({ name: nonblankString.default("otlp") }).safeParse(config);
		return result.success ? result.data.name : "otlp";
	} catch {
		return "otlp";
	}
}

function createResource(
	context: DestinationContext,
): { readonly attributes: readonly OtlpKeyValue[] } | null {
	const attributes: OtlpKeyValue[] = [];
	if (!isObject(context.resourceAttributes)) return null;
	for (const [key, value] of Object.entries(context.resourceAttributes)) {
		const attribute = primitiveAttribute(key, value);
		if (!attribute) return null;
		attributes.push(attribute);
	}
	return { attributes };
}

function primitiveAttribute(key: string, value: ResourceAttributeValue): OtlpKeyValue | null {
	if (key.trim().length === 0) return null;
	const encoded = primitiveValue(value);
	return encoded ? { key, value: encoded } : null;
}

function primitiveValue(value: ResourceAttributeValue): OtlpAnyValue | null {
	switch (typeof value) {
		case "string":
			return { stringValue: value };
		case "boolean":
			return { boolValue: value };
		case "number":
			if (!Number.isFinite(value)) return null;
			return Number.isSafeInteger(value) && !Object.is(value, -0)
				? { intValue: String(value) }
				: { doubleValue: value };
		default:
			return null;
	}
}

function structuredValue(value: StructuredValue): OtlpAnyValue {
	if (value === null) return { stringValue: "null" };
	if (typeof value === "string") return { stringValue: value };
	if (typeof value === "boolean") return { boolValue: value };
	if (typeof value === "number") {
		return Number.isSafeInteger(value) && !Object.is(value, -0)
			? { intValue: String(value) }
			: { doubleValue: value };
	}
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map(structuredValue) } };
	}

	return {
		kvlistValue: {
			values: Object.entries(value).map(([key, nested]) => ({
				key,
				value: structuredValue(nested),
			})),
		},
	};
}

function toUnixNano(timestamp: Date): string | null {
	const milliseconds = timestamp.getTime();
	if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;

	const nanoseconds = BigInt(milliseconds) * 1_000_000n;
	if (nanoseconds > MAX_UINT64) return null;
	return nanoseconds.toString();
}

const severityByLevel: Readonly<
	Record<LogLevel, { readonly severityNumber: number; readonly severityText: string }>
> = {
	verbose: { severityNumber: 1, severityText: "VERBOSE" },
	debug: { severityNumber: 5, severityText: "DEBUG" },
	info: { severityNumber: 9, severityText: "INFO" },
	event: { severityNumber: 9, severityText: "EVENT" },
	warn: { severityNumber: 13, severityText: "WARN" },
	error: { severityNumber: 17, severityText: "ERROR" },
};

function createLogRecord(entry: LogEntry) {
	const timeUnixNano = toUnixNano(entry.timestamp);
	if (!timeUnixNano) return null;

	const severity = severityByLevel[entry.level];
	if (!severity || typeof entry.message !== "string" || typeof entry.event !== "string")
		return null;

	const attributes: OtlpKeyValue[] = [{ key: "event", value: { stringValue: entry.event } }];
	if (entry.module !== undefined) {
		if (typeof entry.module !== "string") return null;
		attributes.push({ key: "module", value: { stringValue: entry.module } });
	}
	attributes.push({
		key: "metadata",
		value: structuredValue(normalizeStructuredValue(entry.metadata)),
	});

	return {
		timeUnixNano,
		...severity,
		body: { stringValue: entry.message },
		attributes,
	};
}

function exportLogs(
	config: ResolvedConfig,
	resource: { readonly attributes: readonly OtlpKeyValue[] },
	records: readonly LogEntry[],
	context: ExportContext,
): ResultAsync<ExportResult, ExportFailure> {
	return ResultAsync.fromPromise(
		(async () => {
			const logRecords = [];
			let locallyRejected = 0;
			for (const entry of records) {
				const record = createLogRecord(entry);
				if (record) logRecords.push(record);
				else locallyRejected += 1;
			}

			if (logRecords.length === 0) return { rejectedRecords: locallyRejected };

			const payload = {
				resourceLogs: [
					{
						resource,
						scopeLogs: [
							{
								scope: { name: INSTRUMENTATION_SCOPE_NAME },
								logRecords,
							},
						],
					},
				],
			};
			const rejected = await postOtlp(
				config.logsUrl,
				config.headers,
				payload,
				"logs",
				config.encoding,
				"rejectedLogRecords",
				logRecords.length,
				context.signal,
			);
			return { rejectedRecords: locallyRejected + rejected };
		})(),
		(error) => normalizeFailure(error, context.signal),
	);
}

function exportMetrics(
	config: ResolvedConfig,
	resource: { readonly attributes: readonly OtlpKeyValue[] },
	batch: MetricBatch,
	context: ExportContext,
): ResultAsync<ExportResult, ExportFailure> {
	return ResultAsync.fromPromise(
		(async () => {
			const timeUnixNano = toUnixNano(batch.timestamp);
			if (!timeUnixNano) return { rejectedRecords: batch.observations.length };

			const { metrics, rejectedRecords } = createMetrics(batch.observations, timeUnixNano);
			const submittedRecords = metrics.reduce(
				(count, metric) => count + metric.gauge.dataPoints.length,
				0,
			);
			if (submittedRecords === 0) return { rejectedRecords };

			const payload = {
				resourceMetrics: [
					{
						resource,
						scopeMetrics: [
							{
								scope: { name: INSTRUMENTATION_SCOPE_NAME },
								metrics,
							},
						],
					},
				],
			};
			const backendRejected = await postOtlp(
				config.metricsUrl,
				config.headers,
				payload,
				"metrics",
				config.encoding,
				"rejectedDataPoints",
				submittedRecords,
				context.signal,
			);
			return { rejectedRecords: rejectedRecords + backendRejected };
		})(),
		(error) => normalizeFailure(error, context.signal),
	);
}

function createMetrics(observations: readonly MetricObservation[], timeUnixNano: string) {
	const groups = new Map<string, MetricGroup>();
	let rejectedRecords = 0;

	for (const observation of observations) {
		if (!isValidObservation(observation)) {
			rejectedRecords += 1;
			continue;
		}

		const attributes = createMetricAttributes(observation.attributes);
		if (!attributes) {
			rejectedRecords += 1;
			continue;
		}

		const attributeKey = metricAttributeKey(attributes);
		const existing = groups.get(observation.name);
		if (existing) {
			if (existing.unit !== observation.unit || existing.description !== observation.description) {
				rejectedRecords += 1;
				continue;
			}
			// A gauge has one value for an attribute set at a timestamp. Keep the
			// first observation deterministically rather than emitting ambiguous points.
			if (existing.attributeKeys.has(attributeKey)) {
				rejectedRecords += 1;
				continue;
			}
			existing.attributeKeys.add(attributeKey);
			existing.dataPoints.push({ timeUnixNano, asDouble: observation.value, attributes });
			continue;
		}

		groups.set(observation.name, {
			name: observation.name,
			...(observation.unit === undefined ? {} : { unit: observation.unit }),
			...(observation.description === undefined ? {} : { description: observation.description }),
			attributeKeys: new Set([attributeKey]),
			dataPoints: [{ timeUnixNano, asDouble: observation.value, attributes }],
		});
	}

	return {
		metrics: Array.from(
			groups.values(),
			({ attributeKeys: _attributeKeys, dataPoints, ...descriptor }) => ({
				...descriptor,
				gauge: { dataPoints },
			}),
		),
		rejectedRecords,
	};
}

function metricAttributeKey(attributes: readonly OtlpKeyValue[]): string {
	return JSON.stringify([...attributes].sort((left, right) => left.key.localeCompare(right.key)));
}

function isValidObservation(observation: MetricObservation): boolean {
	return (
		observation !== null &&
		typeof observation === "object" &&
		typeof observation.name === "string" &&
		observation.name.trim().length > 0 &&
		typeof observation.value === "number" &&
		Number.isFinite(observation.value) &&
		(observation.unit === undefined || typeof observation.unit === "string") &&
		(observation.description === undefined || typeof observation.description === "string")
	);
}

function createMetricAttributes(
	attributes: MetricObservation["attributes"],
): readonly OtlpKeyValue[] | null {
	const result: OtlpKeyValue[] = [];
	for (const [key, value] of Object.entries(attributes ?? {})) {
		const attribute = primitiveAttribute(key, value);
		if (!attribute) return null;
		result.push(attribute);
	}
	return result;
}

async function postOtlp(
	url: string,
	configuredHeaders: Headers,
	payload: object,
	otlpSignal: OtlpSignal,
	encoding: OtlpEncoding,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
	signal: AbortSignal,
): Promise<number> {
	if (signal.aborted) throw createFailure("OTLP export was aborted", false);

	let body: string | Uint8Array<ArrayBuffer>;
	try {
		body =
			encoding === "json"
				? JSON.stringify(payload)
				: encodeOtlpProtobufRequest(otlpSignal, payload);
	} catch {
		throw createFailure("OTLP export payload could not be encoded", false);
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: new Headers(configuredHeaders),
			body,
			signal,
		});
	} catch (error) {
		if (signal.aborted || isAbortError(error)) {
			throw createFailure("OTLP export was aborted", false);
		}
		throw createFailure("OTLP request failed", true);
	}

	if (response.status !== 200) {
		cancelResponseBody(response);
		const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
		const retryAfterMs = retryable
			? parseRetryAfter(response.headers.get("Retry-After"))
			: undefined;
		throw createFailure(
			`OTLP request failed with HTTP status ${response.status}`,
			retryable,
			retryAfterMs,
		);
	}

	let responseBody: unknown;
	try {
		responseBody = await decodeResponse(response, otlpSignal, encoding);
	} catch (error) {
		if (signal.aborted || isAbortError(error)) {
			throw createFailure("OTLP export was aborted", false);
		}
		if (isInternalFailure(error)) throw error;
		throw createFailure("OTLP response body could not be read", false);
	}

	return parseResponse(responseBody, rejectedField, submittedRecords);
}

function cancelResponseBody(response: Response): void {
	try {
		// Initiate cancellation without waiting for an unbounded underlying source.
		void response.body?.cancel().catch(() => undefined);
	} catch {
		// A locked body must not replace the intended HTTP classification.
	}
}

async function decodeResponse(
	response: Response,
	signal: OtlpSignal,
	encoding: OtlpEncoding,
): Promise<unknown> {
	if (encoding === "protobuf") {
		const buffer = await response.arrayBuffer();
		try {
			return decodeOtlpProtobufResponse(signal, new Uint8Array(buffer));
		} catch {
			throw createFailure("OTLP response was malformed", false);
		}
	}

	const body = await response.text();
	if (body.trim().length === 0) return {};
	try {
		return JSON.parse(body);
	} catch {
		throw createFailure("OTLP response was malformed", false);
	}
}

function parseResponse(
	response: unknown,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
): number {
	if (!isObject(response)) throw createFailure("OTLP response was malformed", false);
	if (!("partialSuccess" in response)) return 0;

	const partialSuccess = response.partialSuccess;
	if (!isObject(partialSuccess)) throw createFailure("OTLP response was malformed", false);
	const rejected = partialSuccess[rejectedField];
	if (rejected === undefined) return 0;

	const count = parseRejectedCount(rejected, submittedRecords);
	if (count === null) throw createFailure("OTLP response was malformed", false);
	return count;
}

function parseRejectedCount(value: unknown, submittedRecords: number): number | null {
	if (typeof value === "number") {
		return Number.isSafeInteger(value) && value >= 0 && value <= submittedRecords ? value : null;
	}
	if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;

	const parsed = BigInt(value);
	if (parsed > BigInt(submittedRecords)) return null;
	return Number(parsed);
}

function parseRetryAfter(value: string | null): number | undefined {
	if (value === null) return undefined;
	if (/^\d+$/u.test(value)) {
		const seconds = Number(value);
		const milliseconds = seconds * 1_000;
		return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
	}

	const retryAt = Date.parse(value);
	if (!Number.isFinite(retryAt)) return undefined;
	return Math.max(0, retryAt - Date.now());
}

function createFailure(
	message: string,
	retryable: boolean,
	retryAfterMs?: number,
): InternalExportFailure {
	return Object.assign(new Error(message), {
		[FAILURE_MARKER]: true as const,
		retryable,
		...(retryAfterMs === undefined ? {} : { retryAfterMs }),
	});
}

function normalizeFailure(error: unknown, signal: AbortSignal): ExportFailure {
	if (isInternalFailure(error)) return error;
	if (signal.aborted || isAbortError(error)) return createFailure("OTLP export was aborted", false);
	return createFailure("OTLP export failed", false);
}

function isInternalFailure(error: unknown): error is InternalExportFailure {
	return error instanceof Error && FAILURE_MARKER in error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
