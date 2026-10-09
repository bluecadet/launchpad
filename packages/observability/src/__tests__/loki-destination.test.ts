import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import { createLokiDestination } from "../destinations/loki.js";
import { createLokiTransport } from "../transports/loki.js";

const resourceAttributes: ResourceAttributes = {
	"service.name": "launchpad",
	"service.instance.id": "runtime-7b20",
	"deployment.environment.name": "production",
	"launchpad.client": "natural-history",
	"launchpad.project": "fossils",
	"launchpad.installation": "gallery-2",
	"host.id": "host-should-not-be-a-label",
};

function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2026-03-01T12:34:56.789Z"),
		level: "info",
		message: "content refreshed",
		event: "log:info",
		module: "content",
		metadata: { documents: 12 },
		...overrides,
	};
}

function eventEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return logEntry({
		level: "event",
		message: "content:fetch:success",
		event: "content:fetch:success",
		module: undefined,
		...overrides,
	});
}

function response(status = 204, body = "", headers?: Record<string, string>): Response {
	return new Response(status === 204 ? null : body, { status, headers });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string {
	const body = fetchMock.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected a string request body");
	return body;
}

function logExporter(destination = createLokiDestination({ url: "http://localhost:3100" })) {
	const result = destination.create({ resourceAttributes });
	if (result.isErr()) throw result.error;
	const exporter = result.value.logs;
	if (!exporter) throw new Error("Expected Loki log exporter");
	return exporter;
}

describe("createLokiDestination", () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("is network-inert until export and supports a configurable name", () => {
		const destination = createLokiDestination({
			name: "primary-loki",
			url: "http://localhost:3100",
		});

		expect(destination.name).toBe("primary-loki");
		expect(destination.create({ resourceAttributes }).isOk()).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("posts structured JSON lines and canonical identity labels to the legacy root endpoint", async () => {
		const exporter = logExporter(
			createLokiDestination({
				url: "http://localhost:3100/",
				headers: { "X-Scope-OrgID": "tenant-1" },
			}),
		);
		const signal = new AbortController().signal;

		const result = await exporter.export([logEntry(), eventEntry()], { signal });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:3100/loki/api/v1/push",
			expect.objectContaining({
				method: "POST",
				signal,
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"X-Scope-OrgID": "tenant-1",
				}),
			}),
		);

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
		};
		expect(payload.streams).toHaveLength(2);
		const logStream = payload.streams[0];
		const eventStream = payload.streams[1];
		expect(logStream?.stream).toEqual({
			level: "info",
			service_name: "launchpad",
			client: "natural-history",
			project: "fossils",
			installation: "gallery-2",
			environment: "production",
			module: "content",
		});
		expect(logStream?.stream).not.toHaveProperty("service.instance.id");
		expect(logStream?.stream).not.toHaveProperty("host.id");
		expect(eventStream?.stream).toEqual({
			level: "event",
			service_name: "launchpad",
			client: "natural-history",
			project: "fossils",
			installation: "gallery-2",
			environment: "production",
			event: "content:fetch:success",
		});

		expect(logStream?.values[0]?.[0]).toBe("1772368496789000000");
		const line = JSON.parse(logStream?.values[0]?.[1] ?? "null");
		expect(line).toEqual({
			schemaVersion: 1,
			timestamp: "2026-03-01T12:34:56.789Z",
			event: "log:info",
			level: "info",
			message: "content refreshed",
			module: "content",
			metadata: { documents: 12 },
			resource: resourceAttributes,
		});
	});

	it("uses collision-free stream grouping and sorts values by timestamp", async () => {
		const firstCollision = eventEntry({
			event: "x,installation=gallery-2,level=event,module=y",
			module: "z",
			timestamp: new Date("2026-03-01T12:34:58.000Z"),
		});
		const secondCollision = eventEntry({
			event: "x",
			module: "y,installation=gallery-2,level=event,module=z",
			timestamp: new Date("2026-03-01T12:34:57.000Z"),
		});
		const earlierFirstCollision = {
			...firstCollision,
			timestamp: new Date("2026-03-01T12:34:56.000Z"),
		};

		await logExporter().export([firstCollision, secondCollision, earlierFirstCollision], {
			signal: new AbortController().signal,
		});

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ values: Array<[string, string]> }>;
		};
		expect(payload.streams).toHaveLength(2);
		expect(payload.streams[0]?.values.map(([timestamp]) => timestamp)).toEqual([
			"1772368496000000000",
			"1772368498000000000",
		]);
	});

	it("supports bearer and basic credentials without including them in validation errors", async () => {
		const bearer = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				auth: { type: "bearer", token: "super-secret-token" },
			}),
		);
		await bearer.export([logEntry()], { signal: new AbortController().signal });
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
			Authorization: "Bearer super-secret-token",
		});

		fetchMock.mockClear();
		const basic = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				auth: { type: "basic", username: "user", password: "password" },
			}),
		);
		await basic.export([logEntry()], { signal: new AbortController().signal });
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
			Authorization: `Basic ${Buffer.from("user:password").toString("base64")}`,
		});

		expect(() =>
			createLokiDestination({
				url: "",
				auth: { type: "bearer", token: "must-not-appear" },
			}),
		).toThrowError("Invalid Loki destination configuration");
		try {
			createLokiDestination({
				url: "",
				auth: { type: "bearer", token: "must-not-appear" },
			});
		} catch (error) {
			expect(String(error)).not.toContain("must-not-appear");
		}
	});

	it("contains serialization errors in ResultAsync rather than throwing synchronously", async () => {
		const exporter = logExporter();
		const resultAsync = exporter.export([logEntry({ timestamp: new Date(Number.NaN) })], {
			signal: new AbortController().signal,
		});

		const result = await resultAsync;
		expect(result.isErr()).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("honors a pre-aborted signal and classifies cancellation as permanent", async () => {
		const exporter = logExporter();
		const controller = new AbortController();
		controller.abort();

		const result = await exporter.export([logEntry()], { signal: controller.signal });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({ retryable: false });
	});

	it("sanitizes fetch failures without exposing thrown details", async () => {
		fetchMock.mockRejectedValue(new Error("request contained super-secret-token"));

		const result = await logExporter().export([logEntry()], {
			signal: new AbortController().signal,
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "Loki request failed",
			retryable: true,
		});
		expect(String(result._unsafeUnwrapErr())).not.toContain("super-secret-token");
	});

	it("classifies permanent auth responses as errors that must not retry", async () => {
		fetchMock.mockResolvedValue(response(401, "invalid credentials"));

		const result = await logExporter().export([logEntry()], {
			signal: new AbortController().signal,
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({ retryable: false });
		expect(result._unsafeUnwrapErr().message).toContain("401");
	});

	it("marks transient responses retryable without reading or exposing response details", async () => {
		const rejectedResponse = new Response("response-secret", {
			status: 503,
			statusText: "status-secret",
			headers: { "Retry-After": "2" },
		});
		const text = vi.spyOn(rejectedResponse, "text");
		fetchMock.mockResolvedValue(rejectedResponse);

		const result = await logExporter().export([logEntry()], {
			signal: new AbortController().signal,
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "Loki export failed with HTTP 503",
			retryable: true,
			retryAfterMs: 2_000,
		});
		expect(String(result._unsafeUnwrapErr())).not.toContain("response-secret");
		expect(String(result._unsafeUnwrapErr())).not.toContain("status-secret");
		expect(text).not.toHaveBeenCalled();
	});

	it("treats Loki's blocked-ingestion HTTP 260 response as a permanent failure", async () => {
		fetchMock.mockResolvedValue(response(260, "blocked"));

		const result = await logExporter().export([logEntry()], {
			signal: new AbortController().signal,
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({ retryable: false });
	});

	it("preserves the legacy transport wire body byte-for-byte", async () => {
		const transport = createLokiTransport({
			url: "http://localhost:3100",
			defaultLabels: { app: "launchpad", env: "production" },
		});

		await transport.push([
			logEntry({
				timestamp: new Date("2024-01-01T00:00:00.000Z"),
				message: "unchanged legacy line",
			}),
		]);

		expect(requestBody(fetchMock)).toBe(
			'{"streams":[{"stream":{"app":"launchpad","env":"production","level":"info","module":"content"},"values":[["1704067200000000000","unchanged legacy line"]]}]}',
		);
	});
});
