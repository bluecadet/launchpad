import { describe, expect, it } from "vitest";
import {
	eventToLogEntry,
	isSelectedOperationalLogEvent,
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
		);
		const serialized = serializeLogRecord(normalized);
		const rehydrated = parseLogRecord(serialized);

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
		);

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

		expect(() => parseLogRecord(JSON.stringify({ ...base, metadata: "not-an-object" }))).toThrow(
			"metadata",
		);
		expect(() => parseLogRecord(JSON.stringify({ ...base, resource: "[Truncated]" }))).toThrow(
			"resource",
		);
		expect(() => parseLogRecord(JSON.stringify({ ...base, timestamp: "invalid" }))).toThrow(
			"timestamp",
		);
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
		);
		const serialized = serializeLogRecord(record, 1_024);
		const persisted: unknown = JSON.parse(serialized);
		const rehydrated = parseLogRecord(serialized);

		expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(1_024);
		expect(persisted).toMatchObject({ resource });
		expect(rehydrated.resource["service.instance.id"]).toBe("controller-runtime-id");
	});
});
