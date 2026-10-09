import { err, Result } from "neverthrow";
import type { LogEventPayload } from "./logger.js";

export type ResourceAttributeValue = string | number | boolean;
export type ResourceAttributes = Readonly<Record<string, ResourceAttributeValue>>;

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose" | "event";

export interface LogEntry {
	readonly timestamp: Date;
	readonly level: LogLevel;
	readonly message: string;
	readonly event: string;
	readonly module?: string;
	readonly metadata: Record<string, unknown>;
}

const LOG_EVENTS = new Set(["log:error", "log:warn", "log:info", "log:debug", "log:verbose"]);

/** Bounded operational lifecycle events persisted alongside ordinary logger calls. */
export const SELECTED_OPERATIONAL_LOG_EVENTS = Object.freeze([
	"command:success",
	"command:error",
	"workflow:success",
	"workflow:error",
	"system:shutdown",
	"system:error",
	"content:fetch:done",
	"content:fetch:error",
	"content:version:promoted",
	"content:source:done",
	"content:source:error",
	"monitor:connect:done",
	"monitor:connect:error",
	"monitor:disconnect:done",
	"monitor:app:started",
	"monitor:app:stopped",
	"monitor:app:restarted",
	"monitor:app:error",
	"monitor:app:online",
	"monitor:app:exit",
	"monitor:app:crash",
]);

const SELECTED_OPERATIONAL_LOG_EVENT_SET: ReadonlySet<string> = new Set(
	SELECTED_OPERATIONAL_LOG_EVENTS,
);

export function isSelectedOperationalLogEvent(event: string): boolean {
	return SELECTED_OPERATIONAL_LOG_EVENT_SET.has(event);
}

/** Project a logger or selected lifecycle event to the shared log-entry shape. */
export function eventToLogEntry(event: string, data: unknown): LogEntry {
	if (LOG_EVENTS.has(event)) {
		const payload = data as LogEventPayload;
		return {
			timestamp: new Date(),
			level: event.slice("log:".length) as Exclude<LogLevel, "event">,
			message: payload.message,
			event,
			module: payload.module,
			metadata: { args: payload.args },
		};
	}

	const metadata =
		data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
	return {
		timestamp: new Date(),
		level: "event",
		message: event,
		event,
		metadata,
	};
}

export type LogSourceBarrier = string;
export type LogReadReceipt = string;
export type LogSourceGapReason = "retention" | "truncation" | "corruption";

export interface LogSourceGap {
	readonly reason: LogSourceGapReason;
	/** Number of records known to be lost, or null when it cannot be determined. */
	readonly lostRecords: number | null;
	readonly detail: string;
}

export interface LogReaderIdentity {
	readonly checkpointId: string;
}

export interface LogSourceReadRequest {
	readonly maxEntries: number;
	readonly maxBytes: number;
	readonly through?: LogSourceBarrier;
	readonly signal: AbortSignal;
}

export interface LogSourceBatch {
	readonly records: readonly NormalizedLogRecord[];
	readonly gaps: readonly LogSourceGap[];
	readonly receipt: LogReadReceipt;
	readonly reachedThrough: boolean;
}

export interface LoggerSourceReader {
	read(request: LogSourceReadRequest): Promise<LogSourceBatch>;
	ack(receipt: LogReadReceipt, signal: AbortSignal): Promise<void>;
	close(signal: AbortSignal): Promise<void>;
}

export interface LoggerSourceIdentity {
	readonly sourceId: string;
	readonly runtimeId: string;
	readonly baseResourceAttributes: ResourceAttributes;
}

export interface LoggerSourceStatus {
	readonly available: boolean;
	readonly pendingRecords: number;
	readonly droppedRecords: number;
	readonly lossEvents: number;
	readonly lastError?: string;
}

/** Reader capability for the controller-owned canonical structured log. */
export interface LoggerSource {
	readonly identity: LoggerSourceIdentity;
	/** Current resource snapshot used for future records. */
	readonly resourceAttributes: ResourceAttributes;
	readonly status: LoggerSourceStatus;
	configureResourceAttributes(attributes: ResourceAttributes): void;
	flush(signal: AbortSignal): Promise<LogSourceBarrier>;
	createReader(identity: LogReaderIdentity, signal: AbortSignal): Promise<LoggerSourceReader>;
}

export type StructuredValue =
	| null
	| boolean
	| number
	| string
	| StructuredValue[]
	| { [key: string]: StructuredValue };

export interface StructuredNormalizationOptions {
	/** Maximum nested object/array depth. */
	readonly maxDepth: number;
	/** Maximum enumerable properties retained from one object. */
	readonly maxProperties: number;
	/** Maximum elements retained from one array. */
	readonly maxArrayLength: number;
	/** Maximum characters retained from one string or property name. */
	readonly maxStringLength: number;
	/** Maximum values visited across the entire input graph. */
	readonly maxTotalValues: number;
	/** Maximum string characters retained across the entire input graph. */
	readonly maxTotalStringLength: number;
}

const DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS: StructuredNormalizationOptions = Object.freeze({
	maxDepth: 8,
	maxProperties: 100,
	maxArrayLength: 100,
	maxStringLength: 16_384,
	maxTotalValues: 1_000,
	maxTotalStringLength: 131_072,
});

const STRUCTURED_LOG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_STRUCTURED_LOG_LENGTH = 262_144;
export const REDACTED_VALUE = "[REDACTED]";
export const CIRCULAR_VALUE = "[Circular]";
export const TRUNCATED_VALUE = "[Truncated]";
export const GETTER_VALUE = "[Getter]";
export const UNREADABLE_VALUE = "[Unreadable]";

type NormalizationState = {
	readonly options: StructuredNormalizationOptions;
	readonly ancestors: WeakSet<object>;
	remainingValues: number;
	remainingStringLength: number;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(minimum, Math.floor(value));
}

function resolveOptions(
	options: Partial<StructuredNormalizationOptions>,
): StructuredNormalizationOptions {
	return {
		maxDepth: boundedInteger(
			options.maxDepth,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxDepth,
			0,
		),
		maxProperties: boundedInteger(
			options.maxProperties,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxProperties,
			1,
		),
		maxArrayLength: boundedInteger(
			options.maxArrayLength,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxArrayLength,
			1,
		),
		maxStringLength: boundedInteger(
			options.maxStringLength,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxStringLength,
			1,
		),
		maxTotalValues: boundedInteger(
			options.maxTotalValues,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxTotalValues,
			1,
		),
		maxTotalStringLength: boundedInteger(
			options.maxTotalStringLength,
			DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxTotalStringLength,
			1,
		),
	};
}

function truncateString(value: string, state: NormalizationState): string {
	const availableLength = Math.min(state.options.maxStringLength, state.remainingStringLength);
	if (value.length <= availableLength) {
		state.remainingStringLength -= value.length;
		return value;
	}

	const suffix = `…[truncated ${value.length - availableLength} chars]`;
	const prefixLength = Math.max(0, availableLength - suffix.length);
	state.remainingStringLength -= Math.min(availableLength, value.length);
	return `${value.slice(0, prefixLength)}${suffix.slice(0, availableLength - prefixLength)}`;
}

function propertyKeyString(key: PropertyKey): string {
	return typeof key === "string" ? key : String(key);
}

function normalizePropertyKey(key: PropertyKey, state: NormalizationState): string {
	return truncateString(propertyKeyString(key), state);
}

function setNormalizedProperty(
	target: { [key: string]: StructuredValue },
	key: string,
	value: StructuredValue,
): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

function isSecretKey(key: string): boolean {
	const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
	return (
		normalizedKey === "authorization" ||
		normalizedKey === "proxyauthorization" ||
		normalizedKey === "password" ||
		normalizedKey === "passwd" ||
		normalizedKey === "passphrase" ||
		normalizedKey === "token" ||
		normalizedKey === "apikey" ||
		normalizedKey === "secret" ||
		normalizedKey === "credentials" ||
		normalizedKey === "cookie" ||
		normalizedKey === "setcookie" ||
		normalizedKey.endsWith("password") ||
		normalizedKey.endsWith("token") ||
		normalizedKey.endsWith("apikey") ||
		normalizedKey.endsWith("secret") ||
		normalizedKey.endsWith("privatekey")
	);
}

function ownKeys(value: object): readonly PropertyKey[] | null {
	try {
		// Reflection materializes the complete key list before inspection limits can apply.
		return Reflect.ownKeys(value);
	} catch {
		return null;
	}
}

function ownPropertyDescriptor(value: object, key: PropertyKey): PropertyDescriptor | null {
	try {
		return Reflect.getOwnPropertyDescriptor(value, key) ?? null;
	} catch {
		return null;
	}
}

function dataPropertyInPrototypeChain(value: object, key: PropertyKey): unknown {
	let current: object | null = value;
	for (let depth = 0; current !== null && depth < 8; depth += 1) {
		const descriptor = ownPropertyDescriptor(current, key);
		if (descriptor) return "value" in descriptor ? descriptor.value : GETTER_VALUE;
		try {
			current = Reflect.getPrototypeOf(current);
		} catch {
			return UNREADABLE_VALUE;
		}
	}
	return undefined;
}

function isError(value: object): boolean {
	try {
		return value instanceof Error;
	} catch {
		return false;
	}
}

function isDate(value: object): boolean {
	try {
		return value instanceof Date;
	} catch {
		return false;
	}
}

function isArray(value: object): value is unknown[] {
	try {
		return Array.isArray(value);
	} catch {
		return false;
	}
}

function normalizeError(
	value: object,
	depth: number,
	state: NormalizationState,
): { [key: string]: StructuredValue } {
	const normalized: { [key: string]: StructuredValue } = {};
	const preservedKeys = new Set<PropertyKey>(["name", "message", "stack", "cause"]);

	for (const key of preservedKeys) {
		const propertyValue = dataPropertyInPrototypeChain(value, key);
		if (propertyValue !== undefined) {
			normalized[String(key)] = normalizeValue(propertyValue, depth + 1, state);
		}
	}

	const keys = ownKeys(value);
	if (keys === null) return { ...normalized, properties: UNREADABLE_VALUE };

	let inspectedProperties = 0;
	for (const key of keys) {
		if (preservedKeys.has(key)) continue;
		if (inspectedProperties >= state.options.maxProperties) {
			normalized[TRUNCATED_VALUE] = `${keys.length - inspectedProperties} properties omitted`;
			break;
		}
		inspectedProperties += 1;
		const descriptor = ownPropertyDescriptor(value, key);
		if (!descriptor?.enumerable) continue;
		const normalizedKey = normalizePropertyKey(key, state);
		setNormalizedProperty(
			normalized,
			normalizedKey,
			isSecretKey(propertyKeyString(key))
				? REDACTED_VALUE
				: descriptor.get || descriptor.set
					? GETTER_VALUE
					: normalizeValue(descriptor.value, depth + 1, state),
		);
	}
	return normalized;
}

function normalizeArray(
	value: unknown[],
	depth: number,
	state: NormalizationState,
): StructuredValue[] {
	const lengthDescriptor = ownPropertyDescriptor(value, "length");
	const length =
		lengthDescriptor && "value" in lengthDescriptor && typeof lengthDescriptor.value === "number"
			? lengthDescriptor.value
			: 0;
	const retainedLength = Math.min(length, state.options.maxArrayLength);
	const normalized: StructuredValue[] = [];

	for (let index = 0; index < retainedLength; index += 1) {
		const descriptor = ownPropertyDescriptor(value, String(index));
		if (!descriptor) {
			normalized.push(UNREADABLE_VALUE);
			continue;
		}
		normalized.push(
			descriptor.get || descriptor.set
				? GETTER_VALUE
				: normalizeValue(descriptor.value, depth + 1, state),
		);
	}
	if (length > retainedLength) {
		normalized.push(`[Truncated: ${length - retainedLength} items omitted]`);
	}
	return normalized;
}

function normalizeObject(
	value: object,
	depth: number,
	state: NormalizationState,
): { [key: string]: StructuredValue } {
	const keys = ownKeys(value);
	if (keys === null) return { value: UNREADABLE_VALUE };

	const normalized: { [key: string]: StructuredValue } = {};
	let inspectedProperties = 0;
	for (const key of keys) {
		if (inspectedProperties >= state.options.maxProperties) {
			normalized[TRUNCATED_VALUE] = `${keys.length - inspectedProperties} properties omitted`;
			break;
		}
		inspectedProperties += 1;
		const descriptor = ownPropertyDescriptor(value, key);
		if (!descriptor?.enumerable) continue;

		const normalizedKey = normalizePropertyKey(key, state);
		setNormalizedProperty(
			normalized,
			normalizedKey,
			isSecretKey(propertyKeyString(key))
				? REDACTED_VALUE
				: descriptor.get || descriptor.set
					? GETTER_VALUE
					: normalizeValue(descriptor.value, depth + 1, state),
		);
	}
	return normalized;
}

function normalizeObjectValue(
	value: object,
	depth: number,
	state: NormalizationState,
): StructuredValue {
	if (state.ancestors.has(value)) return CIRCULAR_VALUE;
	if (depth >= state.options.maxDepth) return TRUNCATED_VALUE;

	state.ancestors.add(value);
	try {
		if (isError(value)) return normalizeError(value, depth, state);
		if (isDate(value)) {
			try {
				return Date.prototype.toISOString.call(value);
			} catch {
				return "[Invalid Date]";
			}
		}
		if (isArray(value)) return normalizeArray(value, depth, state);
		return normalizeObject(value, depth, state);
	} finally {
		state.ancestors.delete(value);
	}
}

function normalizeValue(value: unknown, depth: number, state: NormalizationState): StructuredValue {
	if (state.remainingValues <= 0) return TRUNCATED_VALUE;
	state.remainingValues -= 1;

	if (value === null) return null;
	switch (typeof value) {
		case "boolean":
			return value;
		case "number":
			return Number.isFinite(value) ? value : String(value);
		case "string":
			return truncateString(value, state);
		case "bigint":
			return truncateString(value.toString(), state);
		case "undefined":
			return "[undefined]";
		case "symbol":
			return truncateString(String(value), state);
		case "function":
			return "[Function]";
		case "object":
			return normalizeObjectValue(value, depth, state);
		default:
			return UNREADABLE_VALUE;
	}
}

/**
 * Convert an arbitrary value to a bounded JSON-safe value without invoking
 * getters or `toJSON`. Error accessors are represented by a getter marker;
 * data properties such as name, message, stack, and cause are preserved.
 * Circular references and values beyond configured limits become explicit markers.
 *
 * Redaction is deliberately key-based: common token, password, authorization,
 * API-key, cookie, private-key, and secret names are replaced recursively. It
 * cannot identify secrets embedded in free-form strings, encoded values, or
 * unusually named fields, so callers must still avoid placing secrets in logs.
 */
export function normalizeStructuredValue(
	value: unknown,
	options: Partial<StructuredNormalizationOptions> = {},
): StructuredValue {
	const resolvedOptions = resolveOptions(options);
	return normalizeValue(value, 0, {
		options: resolvedOptions,
		ancestors: new WeakSet(),
		remainingValues: resolvedOptions.maxTotalValues,
		remainingStringLength: resolvedOptions.maxTotalStringLength,
	});
}

export interface StructuredLog {
	readonly schemaVersion: typeof STRUCTURED_LOG_SCHEMA_VERSION;
	readonly timestamp: string;
	readonly event: string;
	readonly level: string;
	readonly message: string;
	readonly module?: string;
	readonly metadata: StructuredValue;
	readonly resource: StructuredValue;
}

/** Build the destination-neutral structured representation of a log entry. */
export function createStructuredLog(
	entry: LogEntry,
	resourceAttributes: ResourceAttributes,
	options: Partial<StructuredNormalizationOptions> = {},
): Result<StructuredLog, Error> {
	const normalized = normalizeStructuredValue(
		{
			event: entry.event,
			level: entry.level,
			message: entry.message,
			...(entry.module === undefined ? {} : { module: entry.module }),
			// Preserve canonical identity even when metadata exhausts the global budget.
			resource: resourceAttributes,
			metadata: entry.metadata,
		},
		options,
	);
	if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
		return err(new Error("Failed to normalize structured log"));
	}

	const event = normalized.event;
	const level = normalized.level;
	const message = normalized.message;
	const module = normalized.module;
	if (typeof event !== "string" || typeof level !== "string" || typeof message !== "string") {
		return err(new Error("Failed to normalize required structured log fields"));
	}
	if (module !== undefined && typeof module !== "string") {
		return err(new Error("Failed to normalize structured log module"));
	}

	return Result.fromThrowable(
		() => entry.timestamp.toISOString(),
		() => new Error("Invalid structured log timestamp"),
	)().map((timestamp) => ({
		schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
		timestamp,
		event,
		level,
		message,
		...(module === undefined ? {} : { module }),
		metadata: normalized.metadata ?? null,
		resource: normalized.resource ?? null,
	}));
}

/**
 * Serialize a structured log while keeping a single Loki line byte-bounded. If
 * the normalized metadata still exceeds the limit because of JSON escaping or
 * key overhead, metadata is replaced by an explicit truncation marker.
 */
export function serializeStructuredLog(
	log: StructuredLog,
	maxLength = DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
): Result<string, Error> {
	return Result.fromThrowable(
		() => serializeBoundedStructuredLog(log, maxLength),
		() => new Error("Structured log serialization failed"),
	)();
}

function serializeBoundedStructuredLog(log: StructuredLog, maxLength: number): string {
	const boundedMaxLength = boundedInteger(maxLength, DEFAULT_MAX_STRUCTURED_LOG_LENGTH, 1_024);
	const fits = (serialized: string) => Buffer.byteLength(serialized, "utf8") <= boundedMaxLength;
	const serialized = JSON.stringify(log);
	if (fits(serialized)) return serialized;

	const withoutMetadata = JSON.stringify({
		...log,
		metadata: `[Truncated: structured log exceeded ${boundedMaxLength} bytes]`,
	});
	if (fits(withoutMetadata)) return withoutMetadata;

	const compactOptions = {
		maxDepth: 3,
		maxProperties: 25,
		maxArrayLength: 25,
		maxStringLength: 512,
		maxTotalValues: 100,
		maxTotalStringLength: Math.max(512, Math.floor(boundedMaxLength / 2)),
	};
	const compact = JSON.stringify({
		schemaVersion: log.schemaVersion,
		timestamp: log.timestamp,
		event: normalizeStructuredValue(log.event, compactOptions),
		level: normalizeStructuredValue(log.level, compactOptions),
		message: normalizeStructuredValue(log.message, compactOptions),
		...(log.module === undefined
			? {}
			: { module: normalizeStructuredValue(log.module, compactOptions) }),
		metadata: `[Truncated: structured log exceeded ${boundedMaxLength} bytes]`,
		resource: normalizeStructuredValue(log.resource, compactOptions),
	});
	if (fits(compact)) return compact;

	const fallback = JSON.stringify({
		schemaVersion: log.schemaVersion,
		timestamp: log.timestamp.slice(0, 64),
		event: TRUNCATED_VALUE,
		level: TRUNCATED_VALUE,
		message: `[Truncated: structured log exceeded ${boundedMaxLength} bytes]`,
		metadata: TRUNCATED_VALUE,
		resource: TRUNCATED_VALUE,
	});
	if (fits(fallback)) return fallback;
	return `{"schemaVersion":1,"timestamp":"${TRUNCATED_VALUE}","event":"${TRUNCATED_VALUE}","level":"${TRUNCATED_VALUE}","message":"${TRUNCATED_VALUE}","metadata":"${TRUNCATED_VALUE}","resource":"${TRUNCATED_VALUE}"}`;
}

export interface NormalizedLogRecord extends LogEntry {
	readonly schemaVersion: typeof STRUCTURED_LOG_SCHEMA_VERSION;
	readonly metadata: Readonly<Record<string, StructuredValue>>;
	readonly resource: ResourceAttributes;
}

type PersistedLogRecord = Omit<NormalizedLogRecord, "timestamp"> & {
	readonly timestamp: string;
};

function structuredObject(value: StructuredValue, field: string): Record<string, StructuredValue> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Failed to normalize structured log ${field}`);
	}
	return value;
}

function normalizedResource(
	resourceAttributes: ResourceAttributes,
	options: Partial<StructuredNormalizationOptions>,
): ResourceAttributes {
	const resource = structuredObject(
		normalizeStructuredValue(resourceAttributes, options),
		"resource",
	);
	for (const identityKey of ["service.name", "service.instance.id"]) {
		const descriptor = ownPropertyDescriptor(resourceAttributes, identityKey);
		if (descriptor?.enumerable && "value" in descriptor && descriptor.value !== undefined) {
			setNormalizedProperty(resource, identityKey, descriptor.value);
		}
	}
	for (const [key, value] of Object.entries(resource)) {
		if (
			typeof value !== "string" &&
			typeof value !== "boolean" &&
			!(typeof value === "number" && Number.isFinite(value))
		) {
			throw new Error(`Failed to normalize structured log resource attribute ${key}`);
		}
	}
	return Object.freeze(resource) as ResourceAttributes;
}

/** Normalize and capture a log entry together with its historical resource. */
export function normalizeLogRecord(
	entry: LogEntry,
	resourceAttributes: ResourceAttributes,
	options: Partial<StructuredNormalizationOptions> = {},
): NormalizedLogRecord {
	const timestamp = new Date(entry.timestamp.getTime());
	if (!Number.isFinite(timestamp.getTime())) {
		throw new Error("Failed to normalize structured log timestamp");
	}

	const required = structuredObject(
		normalizeStructuredValue(
			{
				event: entry.event,
				level: entry.level,
				message: entry.message,
				...(entry.module === undefined ? {} : { module: entry.module }),
			},
			options,
		),
		"required fields",
	);
	const event = required.event;
	const level = required.level;
	const message = required.message;
	const module = required.module;
	if (typeof event !== "string" || typeof level !== "string" || typeof message !== "string") {
		throw new Error("Failed to normalize required structured log fields");
	}
	if (!isLogLevel(level)) throw new Error("Failed to normalize structured log level");
	if (module !== undefined && typeof module !== "string") {
		throw new Error("Failed to normalize structured log module");
	}

	const metadata = Object.freeze(
		structuredObject(normalizeStructuredValue(entry.metadata, options), "metadata"),
	);
	return Object.freeze({
		schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
		timestamp,
		event,
		level,
		message,
		...(module === undefined ? {} : { module }),
		metadata,
		resource: normalizedResource(resourceAttributes, options),
	});
}

function persistedRecord(record: NormalizedLogRecord): PersistedLogRecord {
	return {
		schemaVersion: record.schemaVersion,
		timestamp: record.timestamp.toISOString(),
		event: record.event,
		level: record.level,
		message: record.message,
		...(record.module === undefined ? {} : { module: record.module }),
		metadata: record.metadata,
		resource: record.resource,
	};
}

/**
 * Serialize a normalized canonical-file record. Metadata and required text may
 * be replaced to meet the byte bound, but the historical resource always
 * remains a structured primitive map. If that invariant cannot fit, fail.
 */
export function serializeLogRecord(
	record: NormalizedLogRecord,
	maxLength = DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
): string {
	const boundedMaxLength = boundedInteger(maxLength, DEFAULT_MAX_STRUCTURED_LOG_LENGTH, 1_024);
	const fits = (serialized: string) => Buffer.byteLength(serialized, "utf8") <= boundedMaxLength;
	const persisted = persistedRecord(record);
	const serialized = JSON.stringify(persisted);
	if (fits(serialized)) return serialized;

	const metadataMarker = {
		[TRUNCATED_VALUE]: `structured log exceeded ${boundedMaxLength} bytes`,
	};
	const withoutMetadata = JSON.stringify({ ...persisted, metadata: metadataMarker });
	if (fits(withoutMetadata)) return withoutMetadata;

	const compact = JSON.stringify({
		...persisted,
		event: TRUNCATED_VALUE,
		message: `[Truncated: structured log exceeded ${boundedMaxLength} bytes]`,
		...(record.module === undefined ? {} : { module: TRUNCATED_VALUE }),
		metadata: metadataMarker,
	});
	if (fits(compact)) return compact;

	throw new Error(
		`Structured log exceeds ${boundedMaxLength} bytes without discarding resource identity`,
	);
}

const LOG_LEVEL_VALUES: ReadonlySet<string> = new Set([
	"error",
	"warn",
	"info",
	"debug",
	"verbose",
	"event",
]);

function isLogLevel(value: string): value is LogLevel {
	return LOG_LEVEL_VALUES.has(value);
}

function parsedObject(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid structured log ${field}`);
	}
	return value as Record<string, unknown>;
}

function isStructuredValue(value: unknown, depth = 0): value is StructuredValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (depth >= DEFAULT_STRUCTURED_NORMALIZATION_OPTIONS.maxDepth) return false;
	if (Array.isArray(value)) {
		return value.every((item) => isStructuredValue(item, depth + 1));
	}
	if (typeof value !== "object") return false;
	return Object.values(value).every((item) => isStructuredValue(item, depth + 1));
}

function parseMetadata(value: unknown): Readonly<Record<string, StructuredValue>> {
	const metadata = parsedObject(value, "metadata");
	if (!isStructuredValue(metadata)) throw new Error("Invalid structured log metadata");
	return Object.freeze(metadata);
}

function parseResource(value: unknown): ResourceAttributes {
	const candidate = parsedObject(value, "resource");
	const resource: Record<string, ResourceAttributeValue> = {};
	for (const [key, attribute] of Object.entries(candidate)) {
		if (
			typeof attribute !== "string" &&
			typeof attribute !== "boolean" &&
			!(typeof attribute === "number" && Number.isFinite(attribute))
		) {
			throw new Error(`Invalid structured log resource attribute ${key}`);
		}
		setNormalizedProperty(resource, key, attribute);
	}
	return Object.freeze(resource);
}

/** Validate and rehydrate one complete canonical JSONL record. */
export function parseLogRecord(serialized: string): NormalizedLogRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch (error) {
		throw new Error("Invalid structured log JSON", { cause: error });
	}

	const candidate = parsedObject(parsed, "record");
	if (candidate.schemaVersion !== STRUCTURED_LOG_SCHEMA_VERSION) {
		throw new Error("Invalid structured log schemaVersion");
	}
	if (typeof candidate.timestamp !== "string") {
		throw new Error("Invalid structured log timestamp");
	}
	const timestamp = new Date(candidate.timestamp);
	if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== candidate.timestamp) {
		throw new Error("Invalid structured log timestamp");
	}
	if (typeof candidate.event !== "string") throw new Error("Invalid structured log event");
	if (typeof candidate.level !== "string" || !isLogLevel(candidate.level)) {
		throw new Error("Invalid structured log level");
	}
	if (typeof candidate.message !== "string") throw new Error("Invalid structured log message");
	if (candidate.module !== undefined && typeof candidate.module !== "string") {
		throw new Error("Invalid structured log module");
	}

	const metadata = parseMetadata(candidate.metadata);
	return Object.freeze({
		schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
		timestamp,
		event: candidate.event,
		level: candidate.level,
		message: candidate.message,
		...(candidate.module === undefined ? {} : { module: candidate.module }),
		metadata,
		resource: parseResource(candidate.resource),
	});
}
