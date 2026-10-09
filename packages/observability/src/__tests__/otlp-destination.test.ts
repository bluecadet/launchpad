import { once } from "node:events";
import { createServer } from "node:http";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { parse } from "protobufjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DestinationExporters, ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import { encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";
import {
	createOtlpDestination,
	type OtlpDestinationConfig,
	type OtlpSignal,
} from "../destinations/otlp.js";

const RESOURCE: ResourceAttributes = {
	"service.name": "content-api",
	"service.instance.id": "instance-1",
	team: "content",
	region: "us-east-1",
	workers: 4,
	production: true,
};

const BLUECADET_COMPATIBILITY_RESOURCE: ResourceAttributes = {
	"service.name": "launchpad",
	"launchpad.client": "museum",
	"launchpad.project": "gallery",
	"launchpad.installation": "lobby",
	"deployment.environment.name": "production",
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

function exporters(
	config: Partial<OtlpDestinationConfig> = {},
	resourceAttributes: ResourceAttributes = RESOURCE,
): DestinationExporters {
	const destination = createOtlpDestination({
		endpoint: "https://collector.example/proxy/otlp/",
		...config,
	});
	return destination.create({ resourceAttributes })._unsafeUnwrap();
}

function okResponse(body = "{}", headers?: Readonly<Record<string, string>>): Response {
	return new Response(body, { status: 200, headers });
}

function fetchOk(body = "{}"): ReturnType<typeof vi.fn> {
	return vi.fn().mockImplementation(async () => okResponse(body));
}

function fetchProtobufOk(
	body: Uint8Array<ArrayBuffer> = new Uint8Array(),
): ReturnType<typeof vi.fn> {
	return vi.fn().mockImplementation(async () => new Response(body, { status: 200 }));
}

type CapturedRequest = {
	readonly url: string;
	readonly init: RequestInit;
};

function rawRequestFrom(fetchMock: ReturnType<typeof vi.fn>, call = 0): CapturedRequest {
	const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
	return { url, init };
}

function requestFrom(
	fetchMock: ReturnType<typeof vi.fn>,
	call = 0,
): CapturedRequest & { body: Record<string, unknown> } {
	const request = rawRequestFrom(fetchMock, call);
	return {
		...request,
		body: JSON.parse(String(request.init.body)),
	};
}

function protobufResponse(
	signal: OtlpSignal,
	partialSuccess?: Readonly<Record<string, unknown>>,
): Uint8Array<ArrayBuffer> {
	const names =
		signal === "logs"
			? {
					response: "ExportLogsServiceResponse",
					partial: "ExportLogsPartialSuccess",
					rejected: "rejected_log_records",
				}
			: {
					response: "ExportMetricsServiceResponse",
					partial: "ExportMetricsPartialSuccess",
					rejected: "rejected_data_points",
				};
	const schema = `
		syntax = "proto3";
		message ${names.response} { ${names.partial} partial_success = 1; }
		message ${names.partial} {
			int64 ${names.rejected} = 1;
			string error_message = 2;
		}
	`;
	const responseType = parse(schema).root.lookupType(names.response);
	const message = responseType.fromObject(partialSuccess === undefined ? {} : { partialSuccess });
	return Uint8Array.from(responseType.encode(message).finish());
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

function exportedResourceAttributes(body: Record<string, unknown>): Array<{
	key: string;
	value: Record<string, unknown>;
}> {
	if ("resourceLogs" in body) {
		const payload = body as {
			resourceLogs: Array<{
				resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
			}>;
		};
		return payload.resourceLogs[0]!.resource.attributes;
	}

	const payload = body as {
		resourceMetrics: Array<{
			resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
		}>;
	};
	return payload.resourceMetrics[0]!.resource.attributes;
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
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			const destination = createOtlpDestination(config);
			const result = destination.create({ resourceAttributes: RESOURCE });
			expect(result._unsafeUnwrapErr()).toMatchObject({ retryable: false });
			expect(result._unsafeUnwrapErr().message).toContain(message);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it("rejects an unknown encoding without exposing its value", () => {
		const secretEncoding = "private-binary-encoding";
		const invalidConfig: OtlpDestinationConfig = {
			endpoint: "https://collector.example",
			encoding: secretEncoding as never,
		};
		const destination = createOtlpDestination(invalidConfig);
		const failure = destination.create({ resourceAttributes: RESOURCE })._unsafeUnwrapErr();

		expect(failure.message).toContain("encoding");
		expect(failure.message).not.toContain(secretEncoding);
	});

	it("sanitizes invalid token header errors without exposing the token", () => {
		const token = "secret-value\nleak";
		const destination = createOtlpDestination({ endpoint: "https://collector.example", token });
		const failure = destination.create({ resourceAttributes: RESOURCE })._unsafeUnwrapErr();

		expect(failure.message).toContain("headers");
		expect(failure.message).not.toContain("secret-value");
	});

	it.each([
		null,
		undefined,
		"invalid",
		[],
		{ endpoint: "https://collector.example", headers: [] },
		{ endpoint: "https://collector.example", headers: [["x-tenant", "junk"]] },
		{ endpoint: "https://collector.example", headers: "junk" },
		{ endpoint: "https://collector.example", headers: { "invalid header": "value" } },
		{ endpoint: "https://collector.example", signals: "logs" },
		{ endpoint: "https://collector.example", signals: ["unknown"] },
		{ endpoint: "https://collector.example", name: 42 },
	])("defers malformed runtime configuration %# to create without fetching", (config) => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const destination = createOtlpDestination(config as OtlpDestinationConfig);

		expect(typeof destination.name).toBe("string");
		expect(destination.create({ resourceAttributes: RESOURCE })._unsafeUnwrapErr().retryable).toBe(
			false,
		);
		expect(fetchMock).not.toHaveBeenCalled();
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

describe("OTLP resource attributes", () => {
	it("preserves generic service, team, and region attributes in logs and gauges", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const destinationExporters = exporters();

		await destinationExporters.logs!.export([logEntry()], activeContext());
		await destinationExporters.metrics!.export(
			{
				timestamp: new Date("2024-06-15T12:00:00.123Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		const expected = [
			{ key: "service.name", value: { stringValue: "content-api" } },
			{ key: "service.instance.id", value: { stringValue: "instance-1" } },
			{ key: "team", value: { stringValue: "content" } },
			{ key: "region", value: { stringValue: "us-east-1" } },
			{ key: "workers", value: { intValue: "4" } },
			{ key: "production", value: { boolValue: true } },
		];
		expect(exportedResourceAttributes(requestFrom(fetchMock, 0).body)).toEqual(expected);
		expect(exportedResourceAttributes(requestFrom(fetchMock, 1).body)).toEqual(expected);
		expect(expected.map(({ key }) => key)).not.toContain("launchpad.client");
	});

	it("preserves the optional Bluecadet compatibility recipe in both signals", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const destinationExporters = exporters({}, BLUECADET_COMPATIBILITY_RESOURCE);

		await destinationExporters.logs!.export([logEntry()], activeContext());
		await destinationExporters.metrics!.export(
			{
				timestamp: new Date("2024-06-15T12:00:00.123Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		const expected = [
			{ key: "service.name", value: { stringValue: "launchpad" } },
			{ key: "launchpad.client", value: { stringValue: "museum" } },
			{ key: "launchpad.project", value: { stringValue: "gallery" } },
			{ key: "launchpad.installation", value: { stringValue: "lobby" } },
			{
				key: "deployment.environment.name",
				value: { stringValue: "production" },
			},
		];
		expect(exportedResourceAttributes(requestFrom(fetchMock, 0).body)).toEqual(expected);
		expect(exportedResourceAttributes(requestFrom(fetchMock, 1).body)).toEqual(expected);
	});
});

describe("OTLP encoding", () => {
	it("keeps JSON as the default encoding", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);

		const result = await exporters().logs!.export([logEntry()], activeContext());
		const request = rawRequestFrom(fetchMock);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(typeof request.init.body).toBe("string");
		expect(new Headers(request.init.headers).get("content-type")).toBe("application/json");
	});

	it("supports explicit JSON encoding", async () => {
		const fetchMock = fetchOk('{"partialSuccess":{"rejectedLogRecords":"1"}}');
		vi.stubGlobal("fetch", fetchMock);

		const result = await exporters({ encoding: "json" }).logs!.export(
			[logEntry()],
			activeContext(),
		);
		const request = rawRequestFrom(fetchMock);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(typeof request.init.body).toBe("string");
		expect(new Headers(request.init.headers).get("content-type")).toBe("application/json");
	});

	it("encodes log and gauge request payloads as protobuf", async () => {
		const jsonFetch = fetchOk();
		vi.stubGlobal("fetch", jsonFetch);
		const jsonExporters = exporters();
		await jsonExporters.logs!.export([logEntry()], activeContext());
		await jsonExporters.metrics!.export(
			{
				timestamp: new Date("2024-06-15T12:00:00.123Z"),
				observations: [{ name: "temperature", value: 21.5, unit: "Cel" }],
			},
			activeContext(),
		);

		const protobufFetch = fetchProtobufOk();
		vi.stubGlobal("fetch", protobufFetch);
		const protobufExporters = exporters({ encoding: "protobuf" });
		const logResult = await protobufExporters.logs!.export([logEntry()], activeContext());
		const metricResult = await protobufExporters.metrics!.export(
			{
				timestamp: new Date("2024-06-15T12:00:00.123Z"),
				observations: [{ name: "temperature", value: 21.5, unit: "Cel" }],
			},
			activeContext(),
		);

		const logRequest = rawRequestFrom(protobufFetch, 0);
		const metricRequest = rawRequestFrom(protobufFetch, 1);
		const expectedLogs = encodeOtlpProtobufRequest("logs", requestFrom(jsonFetch, 0).body);
		const expectedMetrics = encodeOtlpProtobufRequest("metrics", requestFrom(jsonFetch, 1).body);

		expect(logResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(metricResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(logRequest.init.body).toBeInstanceOf(Uint8Array);
		expect(logRequest.init.body).toEqual(expectedLogs);
		expect(metricRequest.init.body).toBeInstanceOf(Uint8Array);
		expect(metricRequest.init.body).toEqual(expectedMetrics);
		expect(new Headers(logRequest.init.headers).get("content-type")).toBe("application/x-protobuf");
		expect(new Headers(metricRequest.init.headers).get("content-type")).toBe(
			"application/x-protobuf",
		);
	});

	it.each([
		["json", "application/json"],
		["protobuf", "application/x-protobuf"],
	] as const)(
		"does not let custom headers override the %s Content-Type",
		async (encoding, expectedContentType) => {
			const fetchMock = encoding === "json" ? fetchOk() : fetchProtobufOk();
			vi.stubGlobal("fetch", fetchMock);
			const controller = new AbortController();
			const logs = exporters({
				encoding,
				token: "collector-token",
				headers: {
					"cOnTeNt-TyPe": "text/private",
					authorization: "custom credentials",
					"X-Tenant": "museum",
				},
			}).logs!;

			await logs.export([logEntry()], { signal: controller.signal });
			const request = rawRequestFrom(fetchMock);
			const headers = new Headers(request.init.headers);

			expect(headers.get("content-type")).toBe(expectedContentType);
			expect(headers.get("authorization")).toBe("Bearer collector-token");
			expect(headers.get("x-tenant")).toBe("museum");
			expect(request.init.signal).toBe(controller.signal);
		},
	);
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
							{ key: "service.name", value: { stringValue: "content-api" } },
							{ key: "service.instance.id", value: { stringValue: "instance-1" } },
							{ key: "team", value: { stringValue: "content" } },
							{ key: "region", value: { stringValue: "us-east-1" } },
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
	it("decodes responses by configured encoding instead of response Content-Type", async () => {
		const jsonFetch = vi.fn().mockResolvedValue(
			new Response('{"partialSuccess":{"rejectedLogRecords":"1"}}', {
				status: 200,
				headers: { "Content-Type": "application/x-protobuf" },
			}),
		);
		vi.stubGlobal("fetch", jsonFetch);
		const jsonResult = await exporters({ encoding: "json" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		const protobufFetch = vi.fn().mockResolvedValue(
			new Response(protobufResponse("logs", { rejectedLogRecords: "1" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", protobufFetch);
		const protobufResult = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(jsonResult._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(protobufResult._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
	});

	it("combines local and protobuf server rejections for logs and data points", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Response(protobufResponse("logs", { rejectedLogRecords: "1" }), { status: 200 }),
			)
			.mockImplementationOnce(
				async () =>
					new Response(protobufResponse("metrics", { rejectedDataPoints: "1" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const destinationExporters = exporters({ encoding: "protobuf" });

		const logResult = await destinationExporters.logs!.export(
			[logEntry({ timestamp: new Date(-1) }), logEntry()],
			activeContext(),
		);
		const metricResult = await destinationExporters.metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [
					{ name: "up", value: Number.NaN },
					{ name: "up", value: 1 },
				],
			},
			activeContext(),
		);

		expect(logResult._unsafeUnwrap()).toEqual({ rejectedRecords: 2 });
		expect(metricResult._unsafeUnwrap()).toEqual({ rejectedRecords: 2 });
	});

	it.each([
		[{}, 0],
		[{ rejectedLogRecords: "0" }, 0],
		[{ errorMessage: "warning only; do not retry" }, 0],
		[{ rejectedLogRecords: "1", errorMessage: "private server detail" }, 1],
	] as const)("accepts bounded protobuf partial success %#", async (partialSuccess, rejected) => {
		vi.stubGlobal("fetch", fetchProtobufOk(protobufResponse("logs", partialSuccess)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: rejected });
	});

	it.each([
		["oversized", { rejectedLogRecords: "2" }],
		["negative", { rejectedLogRecords: "-1" }],
	] as const)("rejects %s protobuf rejection counts", async (_description, partialSuccess) => {
		vi.stubGlobal("fetch", fetchProtobufOk(protobufResponse("logs", partialSuccess)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
	});

	it("safely rejects an oversized protobuf metric data point count", async () => {
		vi.stubGlobal(
			"fetch",
			fetchProtobufOk(protobufResponse("metrics", { rejectedDataPoints: "9007199254740993" })),
		);

		const result = await exporters({ encoding: "protobuf" }).metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
	});

	it.each(["logs", "metrics"] as const)(
		"treats an unterminated protobuf int64 in a %s response as a permanent failure",
		async (signal) => {
			const malformedInt64 = Uint8Array.from([0x0a, 0x05, 0x08, 0x80, 0x80, 0x80, 0x80]);
			vi.stubGlobal("fetch", fetchProtobufOk(malformedInt64));
			const destinationExporters = exporters({ encoding: "protobuf", signals: [signal] });

			const result =
				signal === "logs"
					? await destinationExporters.logs!.export([logEntry()], activeContext())
					: await destinationExporters.metrics!.export(
							{
								timestamp: new Date("2024-01-01T00:00:00Z"),
								observations: [{ name: "up", value: 1 }],
							},
							activeContext(),
						);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().retryable).toBe(false);
			expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
		},
	);

	it("accepts empty protobuf responses and ignores unknown fields", async () => {
		const withUnknownField = Uint8Array.from([0x98, 0x06, 0x01]);
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(async () => new Response(new Uint8Array(), { status: 200 }))
			.mockImplementationOnce(async () => new Response(withUnknownField, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters({ encoding: "protobuf" }).logs!;

		const emptyResult = await logs.export([logEntry()], activeContext());
		const unknownResult = await logs.export([logEntry()], activeContext());

		expect(emptyResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(unknownResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
	});

	it("rejects a protobuf response when JSON encoding was selected", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response(protobufResponse("logs", { rejectedLogRecords: "1" }))),
		);

		const result = await exporters({ encoding: "json" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP response was malformed",
			retryable: false,
		});
	});

	it.each([
		["truncated protobuf", Uint8Array.from([0x0a, 0x02, 0x08])],
		["JSON in protobuf mode", new TextEncoder().encode('{"private":"response-secret"}')],
	] as const)("treats a malformed %s response as permanent", async (_description, body) => {
		vi.stubGlobal("fetch", fetchProtobufOk(Uint8Array.from(body)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP response was malformed");
		expect(failure.message).not.toContain("response-secret");
	});

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

	it.each([
		[503, true],
		[400, false],
	] as const)(
		"cancels a native streaming HTTP %i body before returning failure",
		async (status, retryable) => {
			const cancel = vi.fn();
			const stream = new ReadableStream<Uint8Array>({ cancel });
			const response = new Response(stream, { status });
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const result = await exporters().logs!.export([logEntry()], activeContext());

			expect(cancel).toHaveBeenCalledOnce();
			expect(response.bodyUsed).toBe(true);
			expect(result._unsafeUnwrapErr()).toMatchObject({
				message: `OTLP request failed with HTTP status ${status}`,
				retryable,
			});
		},
	);

	it.each(["rejects", "never settles", "locked"])(
		"preserves HTTP failure when body cancellation %s",
		async (behavior) => {
			const stream = new ReadableStream<Uint8Array>({
				cancel() {
					return behavior === "rejects"
						? Promise.reject(new Error("private cancellation detail"))
						: new Promise<void>(() => undefined);
				},
			});
			const response = new Response(stream, { status: 503, headers: { "Retry-After": "2" } });
			const reader = behavior === "locked" ? stream.getReader() : undefined;
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			try {
				const result = await exporters().logs!.export([logEntry()], activeContext());
				expect(result._unsafeUnwrapErr()).toMatchObject({
					message: "OTLP request failed with HTTP status 503",
					retryable: true,
					retryAfterMs: 2_000,
				});
			} finally {
				reader?.releaseLock();
			}
		},
	);

	it.each([503, 400])(
		"closes a real HTTP %i response that never finishes streaming",
		async (status) => {
			let responseClosed = false;
			const server = createServer((request, response) => {
				request.resume();
				response.on("close", () => {
					responseClosed = true;
				});
				response.writeHead(status);
				response.write("never-ending backend body");
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			try {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("Expected TCP server address");
				const result = await exporters({
					endpoint: `http://127.0.0.1:${address.port}`,
				}).logs!.export([logEntry()], { signal: AbortSignal.timeout(2_000) });
				expect(result._unsafeUnwrapErr()).toMatchObject({
					message: `OTLP request failed with HTTP status ${status}`,
					retryable: status === 503,
				});
				await vi.waitFor(() => expect(responseClosed).toBe(true), { timeout: 500 });
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		},
	);

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

	it("retains network and Retry-After behavior in protobuf mode", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("private network detail"))
			.mockResolvedValueOnce(
				new Response("private response body", {
					status: 503,
					headers: { "Retry-After": "4" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters({ encoding: "protobuf" }).logs!;

		const networkResult = await logs.export([logEntry()], activeContext());
		const retryResult = await logs.export([logEntry()], activeContext());

		expect(networkResult._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed",
			retryable: true,
		});
		expect(retryResult._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed with HTTP status 503",
			retryable: true,
			retryAfterMs: 4_000,
		});
		expect(networkResult._unsafeUnwrapErr().message).not.toContain("private");
		expect(retryResult._unsafeUnwrapErr().message).not.toContain("private");
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

	it("treats protobuf arrayBuffer read failures as permanent and sanitized", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				arrayBuffer: async () => {
					throw new Error("private response body detail");
				},
			}),
		);

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP response body could not be read");
		expect(failure.message).not.toContain("private");
	});

	it("treats an abort while reading a protobuf body as permanent cancellation", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				arrayBuffer: async () => {
					controller.abort();
					throw new DOMException("private abort detail", "AbortError");
				},
			}),
		);

		const result = await exporters({ encoding: "protobuf" }).logs!.export([logEntry()], {
			signal: controller.signal,
		});
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP export was aborted");
		expect(failure.message).not.toContain("private");
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
