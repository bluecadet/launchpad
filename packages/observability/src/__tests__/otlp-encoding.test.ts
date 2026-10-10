import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";

import {
	activeContext,
	exporters,
	fetchOk,
	fetchProtobufOk,
	logEntry,
	rawRequestFrom,
	requestFrom,
} from "./otlp-destination.test-utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
		const expectedLogs = encodeOtlpProtobufRequest(
			"logs",
			requestFrom(jsonFetch, 0).body,
		)._unsafeUnwrap();
		const expectedMetrics = encodeOtlpProtobufRequest(
			"metrics",
			requestFrom(jsonFetch, 1).body,
		)._unsafeUnwrap();

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
				headers: { "Content-Type": "text/private", "X-Tenant": "museum" },
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
