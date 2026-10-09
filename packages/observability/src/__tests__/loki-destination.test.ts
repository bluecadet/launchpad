import {
	normalizeLogRecord,
	parseLogRecord,
	serializeLogRecord,
} from "@bluecadet/launchpad-utils/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import { createLokiDestination, type LokiDestinationConfig } from "../destinations/loki.js";
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

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, call = 0): string {
	const body = fetchMock.mock.calls[call]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected a string request body");
	return body;
}

function logExporter(
	destination = createLokiDestination({ url: "http://localhost:3100" }),
	resource: ResourceAttributes = resourceAttributes,
) {
	const result = destination.create({ resourceAttributes: resource });
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

	it("uses a credential-free checkpoint key that is stable across auth changes", () => {
		const original = createLokiDestination({
			url: "https://loki.example/gateway/",
			auth: { type: "bearer", token: "first-secret" },
			headers: { "X-Scope-OrgID": "first-tenant-secret" },
		});
		const rotated = createLokiDestination({
			url: "https://loki.example/gateway",
			auth: { type: "bearer", token: "second-secret" },
			headers: { "X-Scope-OrgID": "second-tenant-secret" },
			resourceLabels: { region: "region" },
		});
		const differentEndpoint = createLokiDestination({ url: "https://other-loki.example/gateway" });

		expect(original.checkpointKey).toBe(rotated.checkpointKey);
		expect(original.checkpointKey).not.toBe(differentEndpoint.checkpointKey);
		expect(original.checkpointKey).not.toContain("first-secret");
		expect(original.checkpointKey).not.toContain("first-tenant-secret");
	});

	it("recomputes mapped labels and structured resources for each historical batch", async () => {
		const exporter = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				resourceLabels: {
					"service.name": "service_name",
					region: "region",
				},
			}),
		);
		const historicalResource: ResourceAttributes = {
			"service.name": "archived-worker",
			region: "eu-central-1",
		};

		expect(exporter.supportsResourceContext).toBe(true);
		await exporter.export([logEntry()], {
			signal: new AbortController().signal,
			resourceAttributes: historicalResource,
		});
		await exporter.export([logEntry()], { signal: new AbortController().signal });

		const historicalPayload = JSON.parse(requestBody(fetchMock, 0)) as {
			streams: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
		};
		const currentPayload = JSON.parse(requestBody(fetchMock, 1)) as {
			streams: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
		};
		expect(historicalPayload.streams[0]?.stream).toEqual({
			level: "info",
			service_name: "archived-worker",
			region: "eu-central-1",
			module: "content",
		});
		expect(JSON.parse(historicalPayload.streams[0]?.values[0]?.[1] ?? "null")).toMatchObject({
			resource: historicalResource,
		});
		expect(currentPayload.streams[0]?.stream).toEqual({
			level: "info",
			service_name: "launchpad",
			module: "content",
		});
		expect(JSON.parse(currentPayload.streams[0]?.values[0]?.[1] ?? "null")).toMatchObject({
			resource: resourceAttributes,
		});
	});

	it("replays canonical depth, independent budgets, and long historical identity unchanged", async () => {
		const historicalResource = {
			"service.name": "archived-service-".repeat(1200),
			"service.instance.id": "old-instance-".repeat(1500),
			...Object.fromEntries(
				Array.from({ length: 7 }, (_, index) => [`attribute${index}`, "r".repeat(14000)]),
			),
		};
		const canonical = parseLogRecord(
			serializeLogRecord(
				normalizeLogRecord(
					logEntry({
						metadata: {
							deep: { a: { b: { c: { d: { e: { f: { leaf: "depth-eight" } } } } } } },
							...Object.fromEntries(
								Array.from({ length: 8 }, (_, index) => [`field${index}`, "m".repeat(14000)]),
							),
						},
					}),
					historicalResource,
				),
			),
		);
		const exporter = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				resourceLabels: {
					"service.name": "service_name",
					"service.instance.id": "service_instance_id",
				},
			}),
		);
		const result = await exporter.export([canonical], {
			signal: new AbortController().signal,
			resourceAttributes: canonical.resource,
			recordFormat: "canonical",
		});
		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
		};
		expect(payload.streams[0]?.stream).toMatchObject({
			service_name: historicalResource["service.name"],
			service_instance_id: historicalResource["service.instance.id"],
		});
		const line = payload.streams[0]?.values[0]?.[1] ?? "null";
		expect(JSON.parse(line)).toEqual(JSON.parse(serializeLogRecord(canonical)));
		expect(line).toContain("depth-eight");
		expect(Buffer.byteLength(line)).toBeLessThanOrEqual(262144);
	});

	it("locally rejects an unrepresentable canonical resource instead of replacing identity", async () => {
		const result = await logExporter().export([logEntry()], {
			signal: new AbortController().signal,
			recordFormat: "canonical",
			resourceAttributes: { "service.name": "x".repeat(262144) },
		});
		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([false, true])("redacts raw metadata with resource override=%s", async (override) => {
		await logExporter().export(
			[logEntry({ metadata: { password: "raw-secret", nested: { token: "raw-token" } } })],
			{
				signal: new AbortController().signal,
				...(override ? { resourceAttributes: { "service.name": "old-instance" } } : {}),
			},
		);
		const body = requestBody(fetchMock);
		expect(body).not.toContain("raw-secret");
		expect(body).not.toContain("raw-token");
		expect(body).toContain("[REDACTED]");
	});

	it("indexes only service.name by default while retaining all resource metadata", async () => {
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
			module: "content",
		});
		expect(logStream?.stream).not.toHaveProperty("service.instance.id");
		expect(logStream?.stream).not.toHaveProperty("host.id");
		expect(logStream?.stream).not.toHaveProperty("client");
		expect(logStream?.stream).not.toHaveProperty("project");
		expect(logStream?.stream).not.toHaveProperty("installation");
		expect(logStream?.stream).not.toHaveProperty("environment");
		expect(eventStream?.stream).toEqual({
			level: "event",
			service_name: "launchpad",
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

	it("preserves the previous Bluecadet labels through an explicit compatibility mapping", async () => {
		const compatibilityResource: ResourceAttributes = {
			"service.name": "launchpad",
			"launchpad.client": "museum",
			"launchpad.project": "gallery",
			"launchpad.installation": "lobby",
			"deployment.environment.name": "production",
		};
		const config = {
			url: "http://localhost:3100",
			resourceLabels: {
				"service.name": "service_name",
				"launchpad.client": "client",
				"launchpad.project": "project",
				"launchpad.installation": "installation",
				"deployment.environment.name": "environment",
			},
		} satisfies LokiDestinationConfig;
		const exporter = logExporter(createLokiDestination(config), compatibilityResource);

		await exporter.export([logEntry()], { signal: new AbortController().signal });

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string>; values: Array<[string, string]> }>;
		};
		expect(payload.streams[0]?.stream).toEqual({
			level: "info",
			service_name: "launchpad",
			client: "museum",
			project: "gallery",
			installation: "lobby",
			environment: "production",
			module: "content",
		});
		expect(JSON.parse(payload.streams[0]?.values[0]?.[1] ?? "null")).toEqual({
			schemaVersion: 1,
			timestamp: "2026-03-01T12:34:56.789Z",
			event: "log:info",
			level: "info",
			message: "content refreshed",
			module: "content",
			metadata: { documents: 12 },
			resource: compatibilityResource,
		});
	});

	it("uses a supplied mapping instead of the default and stringifies false and zero", async () => {
		const customResource: ResourceAttributes = {
			"service.name": "custom-service",
			"service.instance.id": "runtime-high-cardinality",
			region: "east",
			team: "content",
			enabled: false,
			replicas: 0,
			nonfinite: Number.POSITIVE_INFINITY,
		};
		const exporter = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				resourceLabels: {
					region: "region",
					team: "team",
					enabled: "enabled",
					replicas: "replicas",
					"service.instance.id": "runtime_instance",
					missing: "missing",
					toString: "stringifier",
					constructor: "resource_constructor",
					nonfinite: "nonfinite",
				},
			}),
			customResource,
		);

		await exporter.export([logEntry()], { signal: new AbortController().signal });

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string> }>;
		};
		expect(payload.streams[0]?.stream).toEqual({
			level: "info",
			region: "east",
			team: "content",
			enabled: "false",
			replicas: "0",
			runtime_instance: "runtime-high-cardinality",
			module: "content",
		});
		expect(payload.streams[0]?.stream).not.toHaveProperty("service_name");
		expect(payload.streams[0]?.stream).not.toHaveProperty("service_instance_id");
		expect(payload.streams[0]?.stream).not.toHaveProperty("missing");
		expect(payload.streams[0]?.stream).not.toHaveProperty("stringifier");
		expect(payload.streams[0]?.stream).not.toHaveProperty("resource_constructor");
		expect(payload.streams[0]?.stream).not.toHaveProperty("nonfinite");
	});

	it("labels explicitly supplied own toString and constructor attributes", async () => {
		const specialResource: ResourceAttributes = {
			toString: "custom-stringifier",
			constructor: 7,
		};
		const exporter = logExporter(
			createLokiDestination({
				url: "http://localhost:3100",
				resourceLabels: {
					toString: "stringifier",
					constructor: "resource_constructor",
				},
			}),
			specialResource,
		);

		await exporter.export([logEntry()], { signal: new AbortController().signal });

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string> }>;
		};
		expect(payload.streams[0]?.stream).toEqual({
			level: "info",
			stringifier: "custom-stringifier",
			resource_constructor: "7",
			module: "content",
		});
	});

	it("rejects an own __proto__ resource mapping before record parsing", () => {
		const resourceLabels: Readonly<Record<string, string>> = JSON.parse(
			'{"__proto__":"prototype_label"}',
		);

		expect(
			createLokiDestination({ url: "http://localhost:3100", resourceLabels })
				.create({ resourceAttributes })
				._unsafeUnwrapErr().message,
		).toBe("Invalid Loki destination configuration");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("allows an empty mapping while retaining log-derived labels", async () => {
		const exporter = logExporter(
			createLokiDestination({ url: "http://localhost:3100", resourceLabels: {} }),
		);

		await exporter.export([logEntry(), eventEntry()], {
			signal: new AbortController().signal,
		});

		const payload = JSON.parse(requestBody(fetchMock)) as {
			streams: Array<{ stream: Record<string, string> }>;
		};
		expect(payload.streams.map(({ stream }) => stream)).toEqual([
			{ level: "info", module: "content" },
			{ level: "event", event: "content:fetch:success" },
		]);
	});

	it.each([
		[{ " ": "valid" }, "blank attribute key"],
		[{ ["a".repeat(129)]: "valid" }, "overlong attribute key"],
		[{ region: "invalid-label" }, "invalid label name"],
		[{ region: `a${"b".repeat(128)}` }, "overlong label name"],
		[{ region: "__internal" }, "internal label name"],
		[{ region: "level" }, "level collision"],
		[{ region: "module" }, "module collision"],
		[{ region: "event" }, "event collision"],
		[{ region: "location", zone: "location" }, "duplicate target name"],
		[
			Object.fromEntries(
				Array.from({ length: 65 }, (_, index) => [`key-${index}`, `label_${index}`]),
			),
			"too many mappings",
		],
	] satisfies Array<[Readonly<Record<string, string>>, string]>)(
		"rejects an invalid resource label mapping: %s",
		(resourceLabels, _description) => {
			expect(
				createLokiDestination({ url: "http://localhost:3100", resourceLabels })
					.create({ resourceAttributes })
					._unsafeUnwrapErr().message,
			).toBe("Invalid Loki destination configuration");
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

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

		const failure = createLokiDestination({
			url: "",
			auth: { type: "bearer", token: "must-not-appear" },
		})
			.create({ resourceAttributes })
			._unsafeUnwrapErr();
		expect(failure.message).toBe("Invalid Loki destination configuration");
		expect(String(failure)).not.toContain("must-not-appear");
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

	it.each([200, 503])("awaits streamed HTTP %i response cancellation", async (status) => {
		const cancelStarted = Promise.withResolvers<void>();
		const cancelFinished = Promise.withResolvers<void>();
		const streamedResponse = new Response(
			new ReadableStream({
				cancel() {
					cancelStarted.resolve();
					return cancelFinished.promise;
				},
			}),
			{ status },
		);
		fetchMock.mockResolvedValue(streamedResponse);
		let settled = false;
		const resultPromise = Promise.resolve(
			logExporter().export([logEntry()], {
				signal: new AbortController().signal,
			}),
		).then((result) => {
			settled = true;
			return result;
		});
		await cancelStarted.promise;
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(settled).toBe(false);
		} finally {
			cancelFinished.resolve();
		}
		const result = await resultPromise;
		expect(result.isOk()).toBe(status === 200);
		expect(streamedResponse.bodyUsed).toBe(true);
	});

	it.each([
		{ url: "not-a-url" },
		{ url: "ftp://private.example" },
		{ url: "https://user:secret@private.example" },
		{ url: "https://private.example?token=secret" },
		{ url: "https://private.example", headers: { "bad header": "secret" } },
		{ url: "https://private.example", auth: { type: "bearer", token: "secret\nvalue" } },
	] satisfies LokiDestinationConfig[])("reports invalid config only from create", (config) => {
		const destination = createLokiDestination(config);
		const failure = destination.create({ resourceAttributes })._unsafeUnwrapErr();
		expect(failure).toMatchObject({
			message: "Invalid Loki destination configuration",
			retryable: false,
		});
		expect(fetchMock).not.toHaveBeenCalled();
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
