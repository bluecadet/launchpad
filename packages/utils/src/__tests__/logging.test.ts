import type { Result } from "neverthrow";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	eventToLogEntry,
	isSelectedOperationalLogEvent,
	type NormalizedLogRecord,
	normalizeLogRecord,
	parseLogRecord,
	REDACTED_VALUE,
	type ResourceAttributes,
	serializeLogRecord,
} from "../logging.js";

const resource: ResourceAttributes = {
	"service.name": "launchpad",
	"service.instance.id": "controller-runtime-id",
	"launchpad.installation": "lobby",
};

describe("shared logging", () => {
	it("projects logger and lifecycle events without changing legacy metadata semantics", () => {
		const args = ["document", 42];
		const log = eventToLogEntry("log:info", {
			message: "Loaded document 42",
			args,
			module: "content",
		});
		const lifecycle = eventToLogEntry("monitor:app:crash", { appName: "player" });

		expect(log).toMatchObject({
			level: "info",
			message: "Loaded document 42",
			event: "log:info",
			module: "content",
			metadata: { args },
		});
		expect(lifecycle).toMatchObject({
			level: "event",
			message: "monitor:app:crash",
			event: "monitor:app:crash",
			metadata: { appName: "player" },
		});
	});

	it("selects bounded operational outcomes without capturing noisy or raw app streams", () => {
		expect(isSelectedOperationalLogEvent("content:fetch:done")).toBe(true);
		expect(isSelectedOperationalLogEvent("monitor:app:crash")).toBe(true);
		expect(isSelectedOperationalLogEvent("content:document:write")).toBe(false);
		expect(isSelectedOperationalLogEvent("monitor:app:log")).toBe(false);
		expect(isSelectedOperationalLogEvent("unknown:event")).toBe(false);
	});

	it("round-trips a normalized record with a Date, object metadata, and historical resource", () => {
		const normalized = normalizeLogRecord(
			{
				timestamp: new Date("2026-03-01T12:34:56.789Z"),
				level: "error",
				message: "Refresh failed",
				event: "log:error",
				module: "content",
				metadata: {
					password: "must not persist",
					cause: new Error("network unavailable"),
				},
			},
			resource,
		)._unsafeUnwrap();
		const serialized = serializeLogRecord(normalized)._unsafeUnwrap();
		const rehydrated = parseLogRecord(serialized)._unsafeUnwrap();

		expect(rehydrated.timestamp).toEqual(new Date("2026-03-01T12:34:56.789Z"));
		expect(rehydrated.timestamp).toBeInstanceOf(Date);
		expect(rehydrated.metadata).toMatchObject({
			password: REDACTED_VALUE,
			cause: { name: "Error", message: "network unavailable" },
		});
		expect(rehydrated.resource).toEqual(resource);
		expect(typeof JSON.parse(serialized).resource).toBe("object");
	});

	it("reserves controller runtime identity independently of normalization text limits", () => {
		const normalized = normalizeLogRecord(
			{
				timestamp: new Date("2026-03-01T12:34:56.789Z"),
				level: "info",
				message: "Ready",
				event: "log:info",
				metadata: {},
			},
			resource,
			{ maxStringLength: 8 },
		)._unsafeUnwrap();

		expect(normalized.resource["service.name"]).toBe("launchpad");
		expect(normalized.resource["service.instance.id"]).toBe("controller-runtime-id");
	});

	it("rejects persisted records that cannot rehydrate as valid normalized records", () => {
		const base = {
			schemaVersion: 1,
			timestamp: "2026-03-01T12:34:56.789Z",
			level: "info",
			message: "Ready",
			event: "log:info",
			metadata: {},
			resource,
		};

		for (const [field, value] of Object.entries({
			metadata: "not-an-object",
			resource: "[Truncated]",
			timestamp: "invalid",
		})) {
			const result = parseLogRecord(JSON.stringify({ ...base, [field]: value }));
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(field);
		}
	});

	it("exposes failures as Results rather than throwing", () => {
		expectTypeOf<ReturnType<typeof normalizeLogRecord>>().toEqualTypeOf<
			Result<NormalizedLogRecord, Error>
		>();
		expectTypeOf<ReturnType<typeof parseLogRecord>>().toEqualTypeOf<
			Result<NormalizedLogRecord, Error>
		>();
		expectTypeOf<ReturnType<typeof serializeLogRecord>>().toEqualTypeOf<Result<string, Error>>();

		const entry = eventToLogEntry("log:info", { message: "Ready", args: [] });
		expect(
			normalizeLogRecord({ ...entry, timestamp: new Date(Number.NaN) }, resource).isErr(),
		).toBe(true);
		expect(normalizeLogRecord(entry, resource, { maxDepth: 0 }).isErr()).toBe(true);
		expect(parseLogRecord("not JSON")._unsafeUnwrapErr()).toBeInstanceOf(Error);

		const canonical = normalizeLogRecord(entry, resource)._unsafeUnwrap();
		expect(serializeLogRecord({ ...canonical, timestamp: new Date(Number.NaN) }).isErr()).toBe(
			true,
		);
		const oversized = normalizeLogRecord(entry, {
			"service.name": "x".repeat(2_000),
		})._unsafeUnwrap();
		expect(serializeLogRecord(oversized, 1_024)._unsafeUnwrapErr().message).toContain(
			"resource identity",
		);
	});

	it("round-trips own prototype-related keys as ordinary data without polluting prototypes", () => {
		const properties = JSON.parse(
			'{"constructor":"own constructor","prototype":"own prototype","__proto__":"own proto"}',
		);
		const metadata = {
			...properties,
			nested: JSON.parse(
				'{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":false}',
			),
		};
		const canonical = normalizeLogRecord(
			{ ...eventToLogEntry("log:info", { message: "Ready", args: [] }), metadata },
			{ ...resource, ...properties },
		)._unsafeUnwrap();
		const serialized = serializeLogRecord(canonical)._unsafeUnwrap();
		const parsed = parseLogRecord(serialized)._unsafeUnwrap();

		expect(parsed.metadata).toEqual(metadata);
		expect(parsed.resource).toEqual({ ...resource, ...properties });
		for (const key of ["constructor", "prototype", "__proto__"]) {
			expect(Object.hasOwn(parsed.metadata, key)).toBe(true);
			expect(Object.hasOwn(parsed.resource, key)).toBe(true);
			expect(parsed.metadata[key]).toBe(properties[key]);
		}
		expect(Object.getPrototypeOf(parsed.metadata)).toBe(Object.prototype);
		expect(Object.getPrototypeOf(parsed.resource)).toBe(Object.prototype);
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
		expect(serializeLogRecord(parsed)._unsafeUnwrap()).toBe(serialized);
	});

	it("keeps resource identity structured when byte bounding replaces metadata", () => {
		const record = normalizeLogRecord(
			{
				timestamp: new Date("2026-03-01T12:34:56.789Z"),
				level: "info",
				message: "Large metadata",
				event: "log:info",
				metadata: { payload: "\0".repeat(100_000) },
			},
			resource,
		)._unsafeUnwrap();
		const serialized = serializeLogRecord(record, 1_024)._unsafeUnwrap();
		const persisted: unknown = JSON.parse(serialized);
		const rehydrated = parseLogRecord(serialized)._unsafeUnwrap();

		expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(1_024);
		expect(persisted).toMatchObject({ resource });
		expect(rehydrated.resource["service.instance.id"]).toBe("controller-runtime-id");
	});
});
