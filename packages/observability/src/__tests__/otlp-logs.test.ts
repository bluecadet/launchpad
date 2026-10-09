import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activeContext,
	exportedLogRecords,
	exporters,
	fetchOk,
	logEntry,
	requestFrom,
} from "./otlp-destination.test-utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
