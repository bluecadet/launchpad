import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { err, ok, ResultAsync } from "neverthrow";
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
import { normalizeStructuredValue, type StructuredValue } from "../core/structured-log.js";

const INSTRUMENTATION_SCOPE_NAME = "@bluecadet/launchpad-observability";
const DEFAULT_SIGNALS = ["logs", "metrics"] as const;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const FAILURE_MARKER = Symbol("otlp-export-failure");

export type OtlpSignal = (typeof DEFAULT_SIGNALS)[number];

export type OtlpDestinationConfig = {
	/** OTLP/HTTP base URL. Signal paths are appended automatically. */
	readonly endpoint: string;
	readonly name?: string;
	readonly token?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly signals?: readonly OtlpSignal[];
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
 * Creates a dependency-free OTLP/HTTP JSON destination for logs and gauge metrics.
 *
 * Severity numbers use the lowest value in each OpenTelemetry range:
 * verbose maps to TRACE (1), debug=DEBUG (5), info/event=INFO (9),
 * warn=WARN (13), and error=ERROR (17). severityText preserves the source level.
 */
export function createOtlpDestination(config: OtlpDestinationConfig): ObservabilityDestination {
	const resolved = resolveConfig(config);

	return {
		name: resolved.name,
		create(context: DestinationContext) {
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

function resolveConfig(config: OtlpDestinationConfig): ResolvedConfig {
	if (!config || typeof config !== "object") {
		throw new Error("Invalid OTLP destination configuration");
	}

	const name = config.name ?? "otlp";
	if (typeof name !== "string" || name.trim().length === 0) {
		throw new Error("OTLP destination name must be nonblank");
	}

	const endpoint = parseEndpoint(config.endpoint);
	const signals = resolveSignals(config.signals);
	const headers = resolveHeaders(config.headers, config.token);

	return {
		name,
		logsUrl: appendSignalPath(endpoint, "/v1/logs"),
		metricsUrl: appendSignalPath(endpoint, "/v1/metrics"),
		headers,
		signals,
	};
}

function parseEndpoint(endpoint: string): URL {
	if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
		throw new Error("OTLP endpoint must be a nonblank URL");
	}

	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("OTLP endpoint must be a valid HTTP(S) URL");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("OTLP endpoint must use HTTP or HTTPS");
	}
	if (parsed.username || parsed.password) {
		throw new Error("OTLP endpoint must not contain credentials");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("OTLP endpoint must not contain a query or fragment");
	}

	return parsed;
}

function appendSignalPath(endpoint: URL, signalPath: string): string {
	const result = new URL(endpoint);
	result.pathname = `${result.pathname.replace(/\/+$/u, "")}${signalPath}`;
	return result.toString();
}

function resolveSignals(signals: readonly OtlpSignal[] | undefined): ReadonlySet<OtlpSignal> {
	const configured = signals ?? DEFAULT_SIGNALS;
	if (!Array.isArray(configured) || configured.length === 0) {
		throw new Error("OTLP destination must configure at least one signal");
	}

	const unique = new Set<OtlpSignal>();
	for (const signal of configured) {
		if (signal !== "logs" && signal !== "metrics") {
			throw new Error("OTLP destination contains an unsupported signal");
		}
		if (unique.has(signal)) {
			throw new Error("OTLP destination signals must not contain duplicates");
		}
		unique.add(signal);
	}
	return unique;
}

function resolveHeaders(
	headers: Readonly<Record<string, string>> | undefined,
	token: string | undefined,
): Headers {
	if (token !== undefined && (typeof token !== "string" || token.trim().length === 0)) {
		throw new Error("OTLP token must be nonblank when provided");
	}

	const result = new Headers();
	try {
		for (const [key, value] of Object.entries(headers ?? {})) {
			if (key.trim().length === 0 || typeof value !== "string" || value.trim().length === 0) {
				throw new Error();
			}
			result.set(key, value);
		}

		result.set("Content-Type", "application/json");
		if (token !== undefined) result.set("Authorization", `Bearer ${token}`);
	} catch {
		throw new Error("OTLP headers and token must contain valid nonblank header values");
	}
	return result;
}

function createResource(
	context: DestinationContext,
): { readonly attributes: readonly OtlpKeyValue[] } | null {
	const attributes: OtlpKeyValue[] = [];
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
	payload: unknown,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
	signal: AbortSignal,
): Promise<number> {
	if (signal.aborted) throw createFailure("OTLP export was aborted", false);

	let body: string;
	try {
		body = JSON.stringify(payload);
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

	let responseBody: string;
	try {
		responseBody = await response.text();
	} catch (error) {
		if (signal.aborted || isAbortError(error)) {
			throw createFailure("OTLP export was aborted", false);
		}
		throw createFailure("OTLP response body could not be read", false);
	}

	return parseResponse(responseBody, rejectedField, submittedRecords);
}

function parseResponse(
	body: string,
	rejectedField: "rejectedLogRecords" | "rejectedDataPoints",
	submittedRecords: number,
): number {
	if (body.trim().length === 0) return 0;

	let response: unknown;
	try {
		response = JSON.parse(body);
	} catch {
		throw createFailure("OTLP response was malformed", false);
	}
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
