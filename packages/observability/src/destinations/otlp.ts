import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import type {
	DestinationContext,
	DestinationExporters,
	ExportContext,
	ExportFailure,
	ExportResult,
	LogExportContext,
	MetricBatch,
	ObservabilityDestination,
	ResourceAttributes,
	ResourceAttributeValue,
} from "../core/destination.js";
import { DestinationFailure } from "../core/export-failure.js";
import type { LogEntry, LogLevel } from "../core/log-entry.js";
import { decodeOtlpProtobufResponse, encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";
import { normalizeStructuredValue, type StructuredValue } from "../core/structured-log.js";

const INSTRUMENTATION_SCOPE_NAME = "@bluecadet/launchpad-observability";
const DEFAULT_SIGNALS = ["logs", "metrics"] as const;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export type OtlpSignal = (typeof DEFAULT_SIGNALS)[number];
export type OtlpEncoding = "json" | "protobuf";

/** Local OTLP configuration validation, applied by the destination's create() method. */
export const otlpDestinationConfigSchema = z
	.object({
		/** OTLP/HTTP base URL. Signal paths are appended automatically. */
		endpoint: z
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
			}, "OTLP endpoint must be an HTTP(S) URL without credentials, query, or fragment"),
		name: z
			.string()
			.refine((value) => value.trim().length > 0)
			.default("otlp"),
		token: z
			.string()
			.refine((value) => value.trim().length > 0)
			.optional(),
		headers: z
			.record(
				z.string().min(1),
				z.string().refine((value) => value.trim().length > 0),
			)
			.optional(),
		signals: z
			.array(z.enum(DEFAULT_SIGNALS))
			.nonempty()
			.readonly()
			.refine((signals) => new Set(signals).size === signals.length, "OTLP signals must be unique")
			.default(DEFAULT_SIGNALS),
		/** OTLP/HTTP request and response encoding. Defaults to JSON. */
		encoding: z.enum(["json", "protobuf"]).default("json"),
	})
	.refine(
		(config) =>
			Result.fromThrowable(
				() => createHeaders(config),
				() => false,
			)().isOk(),
		"OTLP headers and token must contain valid header values",
	);

export type OtlpDestinationConfig = z.input<typeof otlpDestinationConfigSchema>;
export type ResolvedOtlpDestinationConfig = z.output<typeof otlpDestinationConfigSchema>;

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

type ResolvedConfig = {
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
 * The factory is inert: create() validates configuration and returns a sanitized
 * error Result for invalid options. Neither phase performs network requests.
 *
 * Severity numbers use the lowest value in each OpenTelemetry range:
 * verbose maps to TRACE (1), debug=DEBUG (5), info/event=INFO (9),
 * warn=WARN (13), and error=ERROR (17). severityText preserves the source level.
 */
export function createOtlpDestination(config: OtlpDestinationConfig): ObservabilityDestination {
	const endpoint = normalizeEndpoint(config?.endpoint);
	return {
		name: typeof config?.name === "string" ? config.name : "otlp",
		checkpointKey: endpoint === undefined ? undefined : `otlp:${endpoint}`,
		create(context: DestinationContext) {
			const result = resolveConfig(config);
			if (result.isErr()) return err(result.error);
			const resolved = result.value;
			const resource = createResource(context.resourceAttributes);
			if (!resource) {
				return err(createFailure("OTLP resource attributes are invalid", false));
			}

			const exporters: DestinationExporters = {
				...(resolved.signals.has("logs")
					? {
							logs: {
								supportsResourceContext: true,
								export(records: readonly LogEntry[], exportContext: LogExportContext) {
									return exportLogs(
										resolved,
										resource,
										context.resourceAttributes,
										records,
										exportContext,
									);
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

function resolveConfig(config: OtlpDestinationConfig): Result<ResolvedConfig, ExportFailure> {
	const parsed = otlpDestinationConfigSchema.safeParse(config);
	if (!parsed.success) return err(createFailure("Invalid OTLP destination configuration", false));
	const resolved = parsed.data;
	return ok({
		logsUrl: appendSignalPath(resolved.endpoint, "/v1/logs"),
		metricsUrl: appendSignalPath(resolved.endpoint, "/v1/metrics"),
		headers: createHeaders(resolved),
		signals: new Set(resolved.signals),
		encoding: resolved.encoding,
	});
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

function appendSignalPath(endpoint: string, signalPath: string): string {
	const result = new URL(endpoint);
	result.pathname = `${result.pathname.replace(/\/+$/u, "")}${signalPath}`;
	return result.toString();
}

function createHeaders(config: {
	readonly headers?: Readonly<Record<string, string>>;
	readonly token?: string;
	readonly encoding: OtlpEncoding;
}): Headers {
	const headers = new Headers(config.headers);
	headers.set(
		"Content-Type",
		config.encoding === "json" ? "application/json" : "application/x-protobuf",
	);
	if (config.token !== undefined) headers.set("Authorization", `Bearer ${config.token}`);
	return headers;
}

function createResource(
	resourceAttributes: ResourceAttributes,
): { readonly attributes: readonly OtlpKeyValue[] } | null {
	if (!isObject(resourceAttributes)) return null;
	const attributes: OtlpKeyValue[] = [];
	for (const [key, value] of Object.entries(resourceAttributes)) {
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

function createLogRecord(entry: LogEntry, recordFormat: LogExportContext["recordFormat"]) {
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
		// Only the explicit canonical-source contract permits skipping redaction.
		value: structuredValue(
			recordFormat === "canonical"
				? (entry.metadata as Readonly<Record<string, StructuredValue>>)
				: normalizeStructuredValue(entry.metadata),
		),
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
	factoryResource: { readonly attributes: readonly OtlpKeyValue[] },
	factoryResourceAttributes: ResourceAttributes,
	records: readonly LogEntry[],
	context: LogExportContext,
): ResultAsync<ExportResult, ExportFailure> {
	const resourceAttributes = context.resourceAttributes ?? factoryResourceAttributes;
	const resource =
		resourceAttributes === factoryResourceAttributes
			? factoryResource
			: createResource(resourceAttributes);
	if (!resource) return errAsync(createFailure("OTLP resource attributes are invalid", false));

	const logRecords = [];
	let locallyRejected = 0;
	for (const entry of records) {
		const record = createLogRecord(entry, context.recordFormat);
		if (record) logRecords.push(record);
		else locallyRejected += 1;
	}

	if (logRecords.length === 0) return okAsync({ rejectedRecords: locallyRejected });

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
	return postOtlp(
		config.logsUrl,
		config.headers,
		payload,
		"logs",
		config.encoding,
		"rejectedLogRecords",
		logRecords.length,
		context.signal,
	).map((rejected) => ({ rejectedRecords: locallyRejected + rejected }));
}

function exportMetrics(
	config: ResolvedConfig,
	resource: { readonly attributes: readonly OtlpKeyValue[] },
	batch: MetricBatch,
	context: ExportContext,
): ResultAsync<ExportResult, ExportFailure> {
	const timeUnixNano = toUnixNano(batch.timestamp);
	if (!timeUnixNano) return okAsync({ rejectedRecords: batch.observations.length });

	const { metrics, rejectedRecords } = createMetrics(batch.observations, timeUnixNano);
	const submittedRecords = metrics.reduce(
		(count, metric) => count + metric.gauge.dataPoints.length,
		0,
	);
	if (submittedRecords === 0) return okAsync({ rejectedRecords });

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
	return postOtlp(
		config.metricsUrl,
		config.headers,
		payload,
		"metrics",
		config.encoding,
		"rejectedDataPoints",
		submittedRecords,
		context.signal,
	).map((backendRejected) => ({ rejectedRecords: rejectedRecords + backendRejected }));
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

function postOtlp(
	url: string,
	configuredHeaders: Headers,
	payload: object,
	otlpSignal: OtlpSignal,
	encoding: OtlpEncoding,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
	signal: AbortSignal,
): ResultAsync<number, ExportFailure> {
	if (signal.aborted) return errAsync(createFailure("OTLP export was aborted", false));

	const body =
		encoding === "protobuf"
			? encodeOtlpProtobufRequest(otlpSignal, payload)
			: Result.fromThrowable(
					() => JSON.stringify(payload),
					() => createFailure("OTLP export payload could not be encoded", false),
				)();
	return body.asyncAndThen((encoded) =>
		ResultAsync.fromPromise(
			Promise.resolve().then(() =>
				fetch(url, {
					method: "POST",
					headers: new Headers(configuredHeaders),
					body: encoded,
					signal,
				}),
			),
			(error) =>
				signal.aborted || isAbortError(error)
					? createFailure("OTLP export was aborted", false)
					: createFailure("OTLP request failed", true),
		).andThen((response) => {
			if (response.status !== 200) {
				const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
				const retryAfterMs = retryable
					? parseRetryAfter(response.headers.get("Retry-After"))
					: undefined;
				const failure = createFailure(
					`OTLP request failed with HTTP status ${response.status}`,
					retryable,
					retryAfterMs,
				);
				// Error responses may stream indefinitely. Release their body before
				// settling so retry scheduling cannot accumulate open connections.
				return ResultAsync.fromPromise(
					Promise.resolve().then(() => response.body?.cancel()),
					() => failure,
				).andThen(() => err(failure));
			}
			return decodeResponse(response, otlpSignal, encoding, signal).andThen((decoded) =>
				parseResponse(decoded, rejectedField, submittedRecords),
			);
		}),
	);
}

function decodeResponse(
	response: Response,
	otlpSignal: OtlpSignal,
	encoding: OtlpEncoding,
	signal: AbortSignal,
): ResultAsync<unknown, ExportFailure> {
	const readFailure = (error: unknown) =>
		signal.aborted || isAbortError(error)
			? createFailure("OTLP export was aborted", false)
			: createFailure("OTLP response body could not be read", false);
	const malformed = () => createFailure("OTLP response was malformed", false);
	if (encoding === "protobuf") {
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => response.arrayBuffer()),
			readFailure,
		).andThen((buffer) => decodeOtlpProtobufResponse(otlpSignal, new Uint8Array(buffer)));
	}
	return ResultAsync.fromPromise(
		Promise.resolve().then(() => response.text()),
		readFailure,
	).andThen((body) =>
		body.trim().length === 0
			? ok({})
			: Result.fromThrowable((): unknown => JSON.parse(body), malformed)(),
	);
}

function parseResponse(
	response: unknown,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
): Result<number, ExportFailure> {
	if (!isObject(response)) return err(createFailure("OTLP response was malformed", false));
	if (!("partialSuccess" in response)) return ok(0);

	const partialSuccess = response.partialSuccess;
	if (!isObject(partialSuccess)) return err(createFailure("OTLP response was malformed", false));
	const rejected = partialSuccess[rejectedField];
	if (rejected === undefined) return ok(0);

	const count = parseRejectedCount(rejected, submittedRecords);
	return count === null ? err(createFailure("OTLP response was malformed", false)) : ok(count);
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
): DestinationFailure {
	return new DestinationFailure(message, { retryable, retryAfterMs });
}

function isAbortError(error: unknown): boolean {
	try {
		return error instanceof Error && error.name === "AbortError";
	} catch {
		// Library rejections can contain proxies or throwing property accessors.
		return false;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
