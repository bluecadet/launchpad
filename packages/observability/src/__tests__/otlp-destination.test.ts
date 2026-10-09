import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DestinationExporters, ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import { createOtlpDestination, type OtlpDestinationConfig } from "../destinations/otlp.js";

const RESOURCE: ResourceAttributes = {
	"service.name": "launchpad",
	"service.instance.id": "instance-1",
	"launchpad.client": "bluecadet",
	workers: 4,
	production: true,
};

function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2024-06-15T12:00:00.123Z"),
		level: "info",
		message: "server ready",
		event: "log:info",
		module: "server",
		metadata: { port: 8080 },
		...overrides,
	};
}

function exporters(config: Partial<OtlpDestinationConfig> = {}): DestinationExporters {
	const destination = createOtlpDestination({
		endpoint: "https://collector.example/proxy/otlp/",
		...config,
	});
	return destination.create({ resourceAttributes: RESOURCE })._unsafeUnwrap();
}

function okResponse(body = "{}", headers?: Readonly<Record<string, string>>): Response {
	return new Response(body, { status: 200, headers });
}

function fetchOk(body = "{}"): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue(okResponse(body));
}

function requestFrom(
	fetchMock: ReturnType<typeof vi.fn>,
	call = 0,
): {
	url: string;
	init: RequestInit;
	body: Record<string, unknown>;
} {
	const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
	return {
		url,
		init,
		body: JSON.parse(String(init.body)),
	};
}

function activeContext(): { signal: AbortSignal } {
	return { signal: new AbortController().signal };
}

function exportedLogRecords(body: Record<string, unknown>): Array<{
	severityNumber: number;
	severityText: string;
}> {
	const payload = body as {
		resourceLogs: Array<{
			scopeLogs: Array<{
				logRecords: Array<{ severityNumber: number; severityText: string }>;
			}>;
		}>;
	};
	return payload.resourceLogs[0]!.scopeLogs[0]!.logRecords;
}

function exportedMetrics(body: Record<string, unknown>): Array<{
	gauge: { dataPoints: unknown[] };
}> {
	const payload = body as {
		resourceMetrics: Array<{
			scopeMetrics: Array<{
				metrics: Array<{ gauge: { dataPoints: unknown[] } }>;
			}>;
		}>;
	};
	return payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("createOtlpDestination", () => {
	it("is inert and creates both exporters with the default name", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const destination = createOtlpDestination({ endpoint: "https://collector.example" });
		const created = destination.create({ resourceAttributes: RESOURCE });

		expect(destination.name).toBe("otlp");
		expect(created.isOk()).toBe(true);
		expect(created._unsafeUnwrap().logs).toBeDefined();
		expect(created._unsafeUnwrap().metrics).toBeDefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("supports a custom name and a single configured signal", () => {
		const destination = createOtlpDestination({
			endpoint: "http://localhost:4318",
			name: "local-collector",
			signals: ["metrics"],
		});
		const created = destination.create({ resourceAttributes: RESOURCE })._unsafeUnwrap();

		expect(destination.name).toBe("local-collector");
		expect(created.logs).toBeUndefined();
		expect(created.metrics).toBeDefined();
	});

	it.each([
		[{ endpoint: "" }, "nonblank"],
		[{ endpoint: "collector:4318" }, "HTTP or HTTPS"],
		[{ endpoint: "ftp://collector.example" }, "HTTP or HTTPS"],
		[{ endpoint: "https://user:password@collector.example" }, "credentials"],
		[{ endpoint: "https://collector.example?token=secret" }, "query or fragment"],
		[{ endpoint: "https://collector.example#secret" }, "query or fragment"],
		[{ endpoint: "https://collector.example", name: "  " }, "name"],
		[{ endpoint: "https://collector.example", token: "" }, "token"],
		[{ endpoint: "https://collector.example", signals: [] }, "at least one"],
		[{ endpoint: "https://collector.example", signals: ["logs", "logs"] }, "duplicates"],
		[{ endpoint: "https://collector.example", headers: { "X-Tenant": " " } }, "nonblank"],
	] satisfies Array<[OtlpDestinationConfig, string]>)(
		"rejects invalid configuration %#",
		(config, message) => {
			expect(() => createOtlpDestination(config)).toThrow(message);
		},
	);

	it("sanitizes invalid token header errors without exposing the token", () => {
		const token = "secret-value\nleak";
		let thrown: unknown;

		try {
			createOtlpDestination({ endpoint: "https://collector.example", token });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		const message = thrown instanceof Error ? thrown.message : String(thrown);
		expect(message).not.toContain("secret-value");
	});

	it("returns an error from create for invalid runtime resource attributes", () => {
		const destination = createOtlpDestination({ endpoint: "https://collector.example" });
		const result = destination.create({
			resourceAttributes: { valid: Number.POSITIVE_INFINITY },
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
	});
});

describe("OTLP log export", () => {
	it("posts the exact OTLP JSON fixture with resource and structured log fields", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters().logs!;

		const result = await logs.export([logEntry()], activeContext());
		const request = requestFrom(fetchMock);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(request.url).toBe("https://collector.example/proxy/otlp/v1/logs");
		expect(request.init.method).toBe("POST");
		expect(new Headers(request.init.headers).get("content-type")).toBe("application/json");
		expect(request.body).toEqual({
			resourceLogs: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "launchpad" } },
							{ key: "service.instance.id", value: { stringValue: "instance-1" } },
							{ key: "launchpad.client", value: { stringValue: "bluecadet" } },
							{ key: "workers", value: { intValue: "4" } },
							{ key: "production", value: { boolValue: true } },
						],
					},
					scopeLogs: [
						{
							scope: { name: "@bluecadet/launchpad-observability" },
							logRecords: [
								{
									timeUnixNano: "1718452800123000000",
									severityNumber: 9,
									severityText: "INFO",
									body: { stringValue: "server ready" },
									attributes: [
										{ key: "event", value: { stringValue: "log:info" } },
										{ key: "module", value: { stringValue: "server" } },
										{
											key: "metadata",
											value: {
												kvlistValue: {
													values: [{ key: "port", value: { intValue: "8080" } }],
												},
											},
										},
									],
								},
							],
						},
					],
				},
			],
		});
	});

	it("forwards bearer auth, custom headers, and the caller's AbortSignal", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		const logs = exporters({ token: "collector-token", headers: { "X-Tenant": "museum" } }).logs!;

		await logs.export([logEntry()], { signal: controller.signal });
		const { init } = requestFrom(fetchMock);
		const headers = new Headers(init.headers);

		expect(headers.get("authorization")).toBe("Bearer collector-token");
		expect(headers.get("x-tenant")).toBe("museum");
		expect(init.signal).toBe(controller.signal);
	});

	it("maps all log levels to the documented severity ranges", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const levels = ["verbose", "debug", "info", "event", "warn", "error"] as const;
		const logs = exporters().logs!;

		await logs.export(
			levels.map((level) => logEntry({ level })),
			activeContext(),
		);
		const records = exportedLogRecords(requestFrom(fetchMock).body);

		expect(records.map((record) => [record.severityNumber, record.severityText])).toEqual([
			[1, "VERBOSE"],
			[5, "DEBUG"],
			[9, "INFO"],
			[9, "EVENT"],
			[13, "WARN"],
			[17, "ERROR"],
		]);
	});

	it("rejects out-of-range timestamps individually and combines local and backend rejections", async () => {
		const fetchMock = fetchOk('{"partialSuccess":{"rejectedLogRecords":"1"}}');
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters().logs!;

		const result = await logs.export(
			[
				logEntry({ timestamp: new Date(-1), message: "before epoch" }),
				logEntry({ timestamp: new Date("3000-01-01T00:00:00Z"), message: "too large" }),
				logEntry({ message: "valid" }),
			],
			activeContext(),
		);
		const records = exportedLogRecords(requestFrom(fetchMock).body);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 3 });
		expect(records).toHaveLength(1);
	});

	it("normalizes Error, cyclic, bigint, getter, and secret metadata safely", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const cyclic: Record<string, unknown> = { id: 7 };
		cyclic.self = cyclic;
		const metadata = {
			error: new Error("broken"),
			cyclic,
			large: 9_007_199_254_740_993n,
			password: "must-not-leak",
			get explosive(): string {
				throw new Error("getter secret");
			},
		};
		const logs = exporters().logs!;

		const result = await logs.export([logEntry({ metadata })], activeContext());
		const encoded = JSON.stringify(requestFrom(fetchMock).body);

		expect(result.isOk()).toBe(true);
		expect(encoded).toContain("broken");
		expect(encoded).toContain("9007199254740993");
		expect(encoded).not.toContain("must-not-leak");
		expect(encoded.length).toBeLessThan(20_000);
	});
});

describe("OTLP metric export", () => {
	it("groups gauge observations with the same descriptor into data points", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const metrics = exporters().metrics!;
		const observations: MetricObservation[] = [
			{
				name: "launchpad.process.cpu",
				value: 0.25,
				unit: "1",
				description: "CPU utilization",
				attributes: { process: "api", primary: true },
			},
			{
				name: "launchpad.process.cpu",
				value: 0.5,
				unit: "1",
				description: "CPU utilization",
				attributes: { process: "worker", index: 2 },
			},
		];

		const result = await metrics.export(
			{ timestamp: new Date("2024-06-15T12:00:00.123Z"), observations },
			activeContext(),
		);
		const request = requestFrom(fetchMock);
		const metricsPayload = exportedMetrics(request.body);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(request.url).toBe("https://collector.example/proxy/otlp/v1/metrics");
		expect(metricsPayload).toEqual([
			{
				name: "launchpad.process.cpu",
				unit: "1",
				description: "CPU utilization",
				gauge: {
					dataPoints: [
						{
							timeUnixNano: "1718452800123000000",
							asDouble: 0.25,
							attributes: [
								{ key: "process", value: { stringValue: "api" } },
								{ key: "primary", value: { boolValue: true } },
							],
						},
						{
							timeUnixNano: "1718452800123000000",
							asDouble: 0.5,
							attributes: [
								{ key: "process", value: { stringValue: "worker" } },
								{ key: "index", value: { intValue: "2" } },
							],
						},
					],
				},
			},
		]);
	});

	it("keeps the first conflicting gauge point for the same timestamp and attributes", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const metrics = exporters().metrics!;

		const result = await metrics.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [
					{ name: "temperature", value: 20, attributes: { room: "gallery", floor: 2 } },
					{ name: "temperature", value: 21, attributes: { floor: 2, room: "gallery" } },
				],
			},
			activeContext(),
		);
		const dataPoints = exportedMetrics(requestFrom(fetchMock).body)[0]!.gauge.dataPoints;

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(dataPoints).toHaveLength(1);
		expect(dataPoints[0]).toMatchObject({ asDouble: 20 });
	});

	it("rejects a metric batch whose shared timestamp is outside uint64 nanoseconds", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const metrics = exporters().metrics!;

		const beforeEpoch = await metrics.export(
			{ timestamp: new Date(-1), observations: [{ name: "up", value: 1 }] },
			activeContext(),
		);
		const tooLarge = await metrics.export(
			{
				timestamp: new Date("3000-01-01T00:00:00Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(beforeEpoch._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(tooLarge._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("drops nonfinite and incompatible observations without sending invalid data", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const metrics = exporters().metrics!;
		const observations: MetricObservation[] = [
			{ name: "temperature", value: 20, unit: "Cel" },
			{ name: "temperature", value: Number.NaN, unit: "Cel" },
			{ name: "temperature", value: 68, unit: "degF" },
		];

		const result = await metrics.export(
			{ timestamp: new Date("2024-01-01T00:00:00Z"), observations },
			activeContext(),
		);
		const metricsPayload = exportedMetrics(requestFrom(fetchMock).body);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 2 });
		expect(metricsPayload).toHaveLength(1);
		expect(metricsPayload[0]!.gauge.dataPoints).toHaveLength(1);
	});
});

describe("OTLP responses and failures", () => {
	it.each([
		"",
		"{}",
		'{"partialSuccess":{}}',
		'{"partialSuccess":{"rejectedLogRecords":"0"}}',
		'{"partialSuccess":{"errorMessage":"warning only; do not retry"}}',
	])("accepts successful log response %j", async (body) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());
		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
	});

	it.each([
		['{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"unsafe detail"}}', 1],
		['{"partialSuccess":{"rejectedLogRecords":1}}', 1],
	] as const)("returns terminal partial log rejection", async (body, rejectedRecords) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords });
	});

	it("parses metric data point rejections", async () => {
		vi.stubGlobal(
			"fetch",
			fetchOk('{"partialSuccess":{"rejectedDataPoints":"1","errorMessage":"private"}}'),
		);
		const result = await exporters().metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
	});

	it.each([
		["not-json"],
		["[]"],
		['{"partialSuccess":null}'],
		['{"partialSuccess":{"rejectedLogRecords":-1}}'],
		['{"partialSuccess":{"rejectedLogRecords":"2"}}'],
		['{"partialSuccess":{"rejectedLogRecords":1.5}}'],
	])("treats malformed 200 response as permanent for %s", async (body) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).not.toContain(body);
	});

	it.each([
		[429, true],
		[502, true],
		[503, true],
		[504, true],
		[400, false],
		[401, false],
		[500, false],
	])("sets retryability for HTTP %i", async (status, retryable) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("backend secret", {
					status,
					statusText: "unsafe status text",
				}),
			),
		);

		const result = await exporters().logs!.export([logEntry()], activeContext());
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(retryable);
		expect(failure.message).toBe(`OTLP request failed with HTTP status ${status}`);
		expect(failure.message).not.toContain("backend secret");
		expect(failure.message).not.toContain("unsafe status text");
	});

	it("honors Retry-After for retryable HTTP responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "3" } })),
		);

		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result._unsafeUnwrapErr().retryAfterMs).toBe(3_000);
	});

	it("marks network failures retryable without exposing their message", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect secret-host failed")));

		const result = await exporters().logs!.export([logEntry()], activeContext());
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(true);
		expect(failure.message).toBe("OTLP request failed");
	});

	it("does not send an already-aborted export", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		controller.abort();

		const result = await exporters().logs!.export([logEntry()], { signal: controller.signal });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("treats an abort while reading a 200 body as permanent", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				text: async () => {
					controller.abort();
					throw new DOMException("aborted detail", "AbortError");
				},
			}),
		);

		const result = await exporters().logs!.export([logEntry()], { signal: controller.signal });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP export was aborted");
	});
});
