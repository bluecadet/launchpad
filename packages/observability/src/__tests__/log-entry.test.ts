import { describe, expect, it } from "vitest";
import { eventToLogEntry } from "../core/log-entry.js";

describe("eventToLogEntry", () => {
	describe("log event mapping", () => {
		it("maps log:info to level info with message and module from payload", () => {
			const entry = eventToLogEntry("log:info", {
				message: "Server started",
				module: "http",
				args: [],
			});

			expect(entry.level).toBe("info");
			expect(entry.message).toBe("Server started");
			expect(entry.module).toBe("http");
			expect(entry.event).toBe("log:info");
		});

		it("maps log:error to level error", () => {
			const entry = eventToLogEntry("log:error", {
				message: "Something broke",
				module: "db",
				args: [],
			});

			expect(entry.level).toBe("error");
			expect(entry.message).toBe("Something broke");
		});

		it("maps log:warn to level warn", () => {
			const entry = eventToLogEntry("log:warn", {
				message: "Memory usage high",
				module: "monitor",
				args: [],
			});

			expect(entry.level).toBe("warn");
		});

		it("maps log:debug to level debug", () => {
			const entry = eventToLogEntry("log:debug", {
				message: "Debug details",
				module: "core",
				args: [],
			});

			expect(entry.level).toBe("debug");
		});

		it("maps log:verbose to level verbose", () => {
			const entry = eventToLogEntry("log:verbose", {
				message: "Very verbose output",
				module: "loader",
				args: [],
			});

			expect(entry.level).toBe("verbose");
		});

		it("extracts module from payload", () => {
			const entry = eventToLogEntry("log:info", {
				message: "Test",
				module: "my-module",
				args: [],
			});

			expect(entry.module).toBe("my-module");
		});

		it("sets module to undefined when absent from payload", () => {
			const entry = eventToLogEntry("log:info", {
				message: "Test",
				args: [],
			});

			expect(entry.module).toBeUndefined();
		});

		it("stores args in metadata", () => {
			const args = ["arg1", 42];
			const entry = eventToLogEntry("log:info", {
				message: "Test",
				module: "core",
				args,
			});

			expect(entry.metadata).toEqual({ args });
		});
	});

	describe("non-log event mapping", () => {
		it("maps a lifecycle event to level event with event name as message", () => {
			const entry = eventToLogEntry("monitor:app:crash", { appName: "my-app" });

			expect(entry.level).toBe("event");
			expect(entry.message).toBe("monitor:app:crash");
			expect(entry.event).toBe("monitor:app:crash");
		});

		it("sets metadata from the event payload object", () => {
			const payload = { appName: "my-app", exitCode: 1 };
			const entry = eventToLogEntry("monitor:app:crash", payload);

			expect(entry.metadata).toEqual(payload);
		});

		it("uses empty object as metadata when payload is null", () => {
			const entry = eventToLogEntry("system:startup", null);

			expect(entry.metadata).toEqual({});
		});

		it("uses empty object as metadata when payload is a primitive", () => {
			const entry = eventToLogEntry("system:startup", "some string");

			expect(entry.metadata).toEqual({});
		});

		it("uses empty object as metadata when payload is undefined", () => {
			const entry = eventToLogEntry("system:shutdown", undefined);

			expect(entry.metadata).toEqual({});
		});

		it("does not set module for non-log events", () => {
			const entry = eventToLogEntry("monitor:app:online", { appName: "app" });

			expect(entry.module).toBeUndefined();
		});
	});

	describe("timestamp", () => {
		it("sets timestamp to a Date close to now for log events", () => {
			const before = Date.now();
			const entry = eventToLogEntry("log:info", { message: "test", args: [] });
			const after = Date.now();

			expect(entry.timestamp).toBeInstanceOf(Date);
			expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before);
			expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after);
		});

		it("sets timestamp to a Date close to now for lifecycle events", () => {
			const before = Date.now();
			const entry = eventToLogEntry("monitor:app:crash", {});
			const after = Date.now();

			expect(entry.timestamp).toBeInstanceOf(Date);
			expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before);
			expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after);
		});
	});
});
