import { describe, expect, it, vi } from "vitest";
import type { ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import {
	CIRCULAR_VALUE,
	createStructuredLog,
	DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
	GETTER_VALUE,
	normalizeStructuredValue,
	REDACTED_VALUE,
	serializeStructuredLog,
	TRUNCATED_VALUE,
	UNREADABLE_VALUE,
} from "../core/structured-log.js";

const resourceAttributes: ResourceAttributes = {
	"service.name": "launchpad",
	"service.instance.id": "runtime-id",
	"deployment.environment.name": "production",
	"launchpad.client": "museum",
	"launchpad.project": "gallery",
	"launchpad.installation": "kiosk-1",
};

function objectValue(value: unknown): object {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected an object value");
	}
	return value;
}

function logEntry(metadata: Record<string, unknown> = {}): LogEntry {
	return {
		timestamp: new Date("2026-03-01T12:34:56.789Z"),
		level: "error",
		message: "Something failed",
		event: "log:error",
		module: "content",
		metadata,
	};
}

describe("normalizeStructuredValue", () => {
	it("preserves safe Error data fields, including nested causes", () => {
		const cause = new TypeError("invalid document");
		const error = new Error("refresh failed", { cause });
		Object.defineProperty(error, "stack", { configurable: true, value: "refresh failed stack" });
		Object.defineProperty(cause, "stack", { configurable: true, value: "invalid document stack" });

		const normalized = normalizeStructuredValue({ error });

		expect(normalized).toMatchObject({
			error: {
				name: "Error",
				message: "refresh failed",
				stack: "refresh failed stack",
				cause: {
					name: "TypeError",
					message: "invalid document",
					stack: "invalid document stack",
				},
			},
		});
	});

	it("normalizes circular references and bigint without mutating the source", () => {
		const metadata: Record<string, unknown> = { count: 9n };
		metadata.self = metadata;

		const normalized = normalizeStructuredValue(metadata);

		expect(normalized).toEqual({ count: "9", self: CIRCULAR_VALUE });
		expect(metadata.count).toBe(9n);
		expect(metadata.self).toBe(metadata);
	});

	it("does not invoke getters or toJSON", () => {
		const getter = vi.fn(() => "secret side effect");
		const toJSON = vi.fn(() => ({ replaced: true }));
		const value = { safe: true, toJSON };
		Object.defineProperty(value, "dangerous", { enumerable: true, get: getter });

		const normalized = normalizeStructuredValue(value);

		expect(normalized).toEqual({ safe: true, toJSON: "[Function]", dangerous: GETTER_VALUE });
		expect(getter).not.toHaveBeenCalled();
		expect(toJSON).not.toHaveBeenCalled();
	});

	it("does not invoke Error accessors", () => {
		const name = vi.fn(() => "DangerousError");
		const message = vi.fn(() => "dangerous");
		const cause = vi.fn(() => new Error("dangerous cause"));
		const error = new Error("safe");
		Object.defineProperties(error, {
			name: { configurable: true, get: name },
			message: { configurable: true, get: message },
			cause: { configurable: true, get: cause },
		});

		expect(normalizeStructuredValue(error)).toMatchObject({
			name: GETTER_VALUE,
			message: GETTER_VALUE,
			cause: GETTER_VALUE,
		});
		expect(name).not.toHaveBeenCalled();
		expect(message).not.toHaveBeenCalled();
		expect(cause).not.toHaveBeenCalled();
	});

	it("survives objects whose reflection traps throw", () => {
		const value = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error("no reflection");
				},
			},
		);

		expect(normalizeStructuredValue(value)).toEqual({ value: UNREADABLE_VALUE });

		const { proxy, revoke } = Proxy.revocable<unknown[]>([], {});
		revoke();
		expect(normalizeStructuredValue(proxy)).toEqual({ value: UNREADABLE_VALUE });
	});

	it("redacts common secret keys recursively without scanning ordinary strings", () => {
		const normalized = normalizeStructuredValue({
			token: "top-secret",
			nested: {
				apiKey: "key",
				client_secret: "client secret",
				Authorization: "Bearer token",
				note: "a password written in free-form text",
			},
		});

		expect(normalized).toEqual({
			token: REDACTED_VALUE,
			nested: {
				apiKey: REDACTED_VALUE,
				client_secret: REDACTED_VALUE,
				Authorization: REDACTED_VALUE,
				note: "a password written in free-form text",
			},
		});

		const longSecretKey = `${"x".repeat(100)}password`;
		const truncatedKey = normalizeStructuredValue(
			{ [longSecretKey]: "must not leak" },
			{ maxStringLength: 8 },
		);
		expect(Object.values(objectValue(truncatedKey))).toEqual([REDACTED_VALUE]);
	});

	it("safely defines __proto__ output keys", () => {
		const input = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(input, "__proto__", { enumerable: true, value: { polluted: true } });

		const normalized = normalizeStructuredValue(input);

		const normalizedObject = objectValue(normalized);
		expect(Object.getPrototypeOf(normalizedObject)).toBe(Object.prototype);
		expect(Object.hasOwn(normalizedObject, "__proto__")).toBe(true);
		expect(Object.getOwnPropertyDescriptor(normalizedObject, "__proto__")?.value).toEqual({
			polluted: true,
		});
		expect({}).not.toHaveProperty("polluted");
	});

	it("bounds bigint strings and counts non-enumerable properties when limiting inspection", () => {
		const value: Record<string, unknown> = {};
		Object.defineProperties(value, {
			hiddenOne: { value: 1 },
			hiddenTwo: { value: 2 },
		});
		value.visible = true;
		const normalized = normalizeStructuredValue(value, {
			maxProperties: 2,
			maxStringLength: 8,
		});

		expect(normalizeStructuredValue(12345678901234567890n, { maxStringLength: 8 })).toContain(
			"trunc",
		);
		expect(normalized).not.toHaveProperty("visible");
		expect(normalized).toHaveProperty(TRUNCATED_VALUE);
	});

	it("bounds depth, property count, array length, and string length", () => {
		const normalized = normalizeStructuredValue(
			{
				array: [1, 2, 3],
				first: "abcdefghij",
				second: { nested: { tooDeep: true } },
			},
			{
				maxDepth: 2,
				maxProperties: 3,
				maxArrayLength: 2,
				maxStringLength: 8,
				maxTotalValues: 20,
				maxTotalStringLength: 100,
			},
		);

		expect(normalized).toMatchObject({
			array: [1, 2, expect.stringContaining("Truncated")],
			first: expect.stringContaining("trunc"),
			second: { nested: TRUNCATED_VALUE },
		});
	});
});

describe("structured log", () => {
	it("reports invalid timestamps as permanent Results", () => {
		const entry = { ...logEntry({}), timestamp: new Date(Number.NaN) };
		expect(createStructuredLog(entry, resourceAttributes)._unsafeUnwrapErr()).toMatchObject({
			message: "Invalid structured log timestamp",
			retryable: false,
		});
	});

	it("reports normalization limits that omit required fields as Results", () => {
		const result = createStructuredLog(logEntry({}), resourceAttributes, { maxProperties: 1 });
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
	});

	it("sanitizes JSON serialization exceptions", () => {
		const log = createStructuredLog(logEntry({}), resourceAttributes)._unsafeUnwrap();
		const cyclic = { ...log, metadata: {} };
		cyclic.metadata = cyclic;
		expect(serializeStructuredLog(cyclic)._unsafeUnwrapErr()).toMatchObject({
			message: "Structured log serialization failed",
			retryable: false,
		});
	});

	it("builds the versioned destination-neutral shape with canonical resource identity", () => {
		const structured = createStructuredLog(
			logEntry({ documentCount: 42 }),
			resourceAttributes,
		)._unsafeUnwrap();

		expect(structured).toEqual({
			schemaVersion: 1,
			timestamp: "2026-03-01T12:34:56.789Z",
			event: "log:error",
			level: "error",
			message: "Something failed",
			module: "content",
			metadata: { documentCount: 42 },
			resource: resourceAttributes,
		});
	});

	it("keeps serialization bounded when escaping expands normalized metadata", () => {
		const metadata = Object.fromEntries(
			Array.from({ length: 100 }, (_, index) => [`field-${index}`, "\0".repeat(16_384)]),
		);
		const serialized = serializeStructuredLog(
			createStructuredLog(logEntry(metadata), resourceAttributes)._unsafeUnwrap(),
		)._unsafeUnwrap();

		expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(DEFAULT_MAX_STRUCTURED_LOG_LENGTH);
		expect(JSON.parse(serialized)).toMatchObject({
			metadata: expect.stringContaining("Truncated"),
			resource: resourceAttributes,
		});
	});

	it("keeps the final fallback bounded when required fields need JSON escaping", () => {
		const serialized = serializeStructuredLog(
			{
				schemaVersion: 1,
				timestamp: "\0".repeat(10_000),
				event: "\0".repeat(10_000),
				level: "\0".repeat(10_000),
				message: "\0".repeat(10_000),
				metadata: "\0".repeat(10_000),
				resource: "\0".repeat(10_000),
			},
			1_024,
		)._unsafeUnwrap();

		expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1_024);
		expect(() => JSON.parse(serialized)).not.toThrow();
	});
});
