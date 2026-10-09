import type { ResourceAttributes } from "./destination.js";
import type { LogEntry } from "./log-entry.js";

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
): StructuredLog {
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
		throw new Error("Failed to normalize structured log");
	}

	const event = normalized.event;
	const level = normalized.level;
	const message = normalized.message;
	const module = normalized.module;
	if (typeof event !== "string" || typeof level !== "string" || typeof message !== "string") {
		throw new Error("Failed to normalize required structured log fields");
	}
	if (module !== undefined && typeof module !== "string") {
		throw new Error("Failed to normalize structured log module");
	}

	return {
		schemaVersion: STRUCTURED_LOG_SCHEMA_VERSION,
		timestamp: entry.timestamp.toISOString(),
		event,
		level,
		message,
		...(module === undefined ? {} : { module }),
		metadata: normalized.metadata ?? null,
		resource: normalized.resource ?? null,
	};
}

/**
 * Serialize a structured log while keeping a single Loki line byte-bounded. If
 * the normalized metadata still exceeds the limit because of JSON escaping or
 * key overhead, metadata is replaced by an explicit truncation marker.
 */
export function serializeStructuredLog(
	log: StructuredLog,
	maxLength = DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
): string {
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
