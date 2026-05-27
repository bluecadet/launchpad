import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../core/log-entry.js";
import { createLokiTransport } from "../transports/loki.js";

function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2024-01-01T00:00:00.000Z"),
		level: "info",
		message: "test message",
		event: "log:info",
		module: "core",
		metadata: {},
		...overrides,
	};
}

function makeEventEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2024-01-01T00:00:00.000Z"),
		level: "event",
		message: "monitor:app:crash",
		event: "monitor:app:crash",
		metadata: { appName: "my-app" },
		...overrides,
	};
}

function mockFetchOk(): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		statusText: "OK",
		text: () => Promise.resolve(""),
	});
}

function mockFetchError(status: number, statusText: string, body = ""): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue({
		ok: false,
		status,
		statusText,
		text: () => Promise.resolve(body),
	});
}

describe("createLokiTransport", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = mockFetchOk();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("successful push", () => {
		it("returns Ok on a successful HTTP response", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			const result = await transport.push([makeLogEntry()]);

			expect(result.isOk()).toBe(true);
		});

		it("calls fetch with the correct Loki push URL", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry()]);

			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:3100/loki/api/v1/push",
				expect.any(Object),
			);
		});

		it("strips trailing slash from base URL before appending path", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100/" });
			await transport.push([makeLogEntry()]);

			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:3100/loki/api/v1/push",
				expect.any(Object),
			);
		});

		it("uses POST method", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry()]);

			expect(fetchMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("sets Content-Type header to application/json", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			expect(options.headers["Content-Type"]).toBe("application/json");
		});
	});

	describe("error handling", () => {
		it("returns Err when HTTP status is 503", async () => {
			vi.stubGlobal("fetch", mockFetchError(503, "Service Unavailable"));
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			const result = await transport.push([makeLogEntry()]);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("503");
		});

		it("error message includes status code", async () => {
			vi.stubGlobal("fetch", mockFetchError(429, "Too Many Requests", "rate limited"));
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			const result = await transport.push([makeLogEntry()]);

			expect(result.isErr()).toBe(true);
			const msg = result._unsafeUnwrapErr().message;
			expect(msg).toContain("429");
		});

		it("returns Err when fetch throws a network error", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			const result = await transport.push([makeLogEntry()]);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Network failure");
		});

		it("wraps non-Error throws in an Error", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string error"));
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			const result = await transport.push([makeLogEntry()]);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(Error);
		});
	});

	describe("authentication", () => {
		it("sets basic auth Authorization header", async () => {
			const transport = createLokiTransport({
				url: "http://localhost:3100",
				auth: { type: "basic", username: "user", password: "pass" },
			});
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
			expect(options.headers.Authorization).toBe(expected);
		});

		it("sets bearer auth Authorization header", async () => {
			const transport = createLokiTransport({
				url: "http://localhost:3100",
				auth: { type: "bearer", token: "my-secret-token" },
			});
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			expect(options.headers.Authorization).toBe("Bearer my-secret-token");
		});

		it("does not set Authorization header when no auth is configured", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			expect(options.headers.Authorization).toBeUndefined();
		});
	});

	describe("custom headers", () => {
		it("forwards custom headers to fetch", async () => {
			const transport = createLokiTransport({
				url: "http://localhost:3100",
				headers: { "X-Custom-Header": "value", "X-Tenant-ID": "abc123" },
			});
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			expect(options.headers["X-Custom-Header"]).toBe("value");
			expect(options.headers["X-Tenant-ID"]).toBe("abc123");
		});
	});

	describe("Loki payload structure", () => {
		it("log events get stream labels with level and module", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry({ level: "info", module: "http", event: "log:info" })]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			expect(payload.streams).toHaveLength(1);
			expect(payload.streams[0].stream).toMatchObject({ level: "info", module: "http" });
		});

		it("lifecycle events get stream labels with level event and event name", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeEventEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			expect(payload.streams).toHaveLength(1);
			expect(payload.streams[0].stream).toMatchObject({
				level: "event",
				event: "monitor:app:crash",
			});
		});

		it("log events without module do not include module label", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry({ level: "info", module: undefined, event: "log:info" })]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			expect(payload.streams[0].stream).not.toHaveProperty("module");
		});

		it("defaultLabels appear in every stream label set", async () => {
			const transport = createLokiTransport({
				url: "http://localhost:3100",
				defaultLabels: { app: "launchpad", env: "production" },
			});
			await transport.push([
				makeLogEntry({ level: "info", module: "core", event: "log:info" }),
				makeEventEntry(),
			]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			for (const stream of payload.streams) {
				expect(stream.stream).toMatchObject({ app: "launchpad", env: "production" });
			}
		});

		it("multiple entries with the same labels go into one stream", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			const ts1 = new Date("2024-01-01T00:00:01.000Z");
			const ts2 = new Date("2024-01-01T00:00:02.000Z");

			await transport.push([
				makeLogEntry({
					level: "info",
					module: "core",
					event: "log:info",
					timestamp: ts1,
					message: "msg1",
				}),
				makeLogEntry({
					level: "info",
					module: "core",
					event: "log:info",
					timestamp: ts2,
					message: "msg2",
				}),
			]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			expect(payload.streams).toHaveLength(1);
			expect(payload.streams[0].values).toHaveLength(2);
		});

		it("multiple entries with different labels go into separate streams", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			await transport.push([
				makeLogEntry({ level: "info", module: "http", event: "log:info" }),
				makeLogEntry({ level: "error", module: "db", event: "log:error" }),
			]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);

			expect(payload.streams).toHaveLength(2);
		});
	});

	describe("timestamp format", () => {
		it("formats timestamp as nanosecond string ending in 000000", async () => {
			const ts = new Date("2024-06-15T12:00:00.123Z");
			const transport = createLokiTransport({ url: "http://localhost:3100" });

			await transport.push([makeLogEntry({ timestamp: ts })]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);
			const tsValue: string = payload.streams[0].values[0][0];

			expect(tsValue).toBe(`${ts.getTime()}000000`);
			expect(tsValue.endsWith("000000")).toBe(true);
		});

		it("timestamp string is numeric (no decimals or letters)", async () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			await transport.push([makeLogEntry()]);

			const [, options] = fetchMock.mock.calls[0]!;
			const payload = JSON.parse(options.body);
			const tsValue: string = payload.streams[0].values[0][0];

			expect(/^\d+$/.test(tsValue)).toBe(true);
		});
	});

	describe("transport name", () => {
		it("has name loki", () => {
			const transport = createLokiTransport({ url: "http://localhost:3100" });
			expect(transport.name).toBe("loki");
		});
	});
});
