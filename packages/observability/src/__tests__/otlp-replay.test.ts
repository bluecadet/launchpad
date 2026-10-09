import {
	normalizeLogRecord,
	parseLogRecord,
	serializeLogRecord,
} from "@bluecadet/launchpad-utils/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceAttributes } from "../core/destination.js";
import { encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";
import { createOtlpDestination } from "../destinations/otlp.js";
import {
	activeContext,
	exportedResourceAttributes,
	exporters,
	fetchOk,
	fetchProtobufOk,
	logEntry,
	rawRequestFrom,
	requestFrom,
} from "./otlp-destination.test-utils.js";

const HISTORICAL_RESOURCE: ResourceAttributes = {
	"service.name": "content-worker",
	"service.instance.id": "archived-instance",
	region: "eu-west-1",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("OTLP replay resources", () => {
	it("preserves canonical metadata and resources through the JSON and protobuf pipelines", async () => {
		const canonical = parseLogRecord(
			serializeLogRecord(
				normalizeLogRecord(
					logEntry({
						metadata: {
							deep: { a: { b: { c: { d: { e: { f: { leaf: "depth-eight" } } } } } } },
							...Object.fromEntries(
								Array.from({ length: 105 }, (_, index) => [`field${index}`, index]),
							),
						},
					}),
					{
						...HISTORICAL_RESOURCE,
						"service.name": "archived-service-".repeat(1200),
						"service.instance.id": "old-instance-".repeat(1500),
					},
				),
			),
		);
		const jsonFetch = fetchOk();
		vi.stubGlobal("fetch", jsonFetch);
		const destinationExporters = exporters();
		const context = {
			...activeContext(),
			resourceAttributes: canonical.resource,
			recordFormat: "canonical" as const,
		};
		expect((await destinationExporters.logs!.export([canonical], context))._unsafeUnwrap()).toEqual(
			{ rejectedRecords: 0 },
		);
		const payload = requestFrom(jsonFetch).body;
		const deepValue = {
			kvlistValue: { values: [{ key: "leaf", value: { stringValue: "depth-eight" } }] },
		};
		const nestedValue = ["f", "e", "d", "c", "b", "a"].reduce<object>(
			(value, key) => ({ kvlistValue: { values: [{ key, value }] } }),
			deepValue,
		);
		expect(payload).toMatchObject({
			resourceLogs: [
				{
					scopeLogs: [
						{
							logRecords: [
								{
									timeUnixNano: "1718452800123000000",
									attributes: [
										{ key: "event", value: { stringValue: canonical.event } },
										{ key: "module", value: { stringValue: canonical.module } },
										{
											key: "metadata",
											value: {
												kvlistValue: {
													values: [
														{ key: "deep", value: nestedValue },
														...Object.entries(canonical.metadata)
															.filter(([key]) => key !== "deep")
															.map(([key, value]) => ({
																key,
																value:
																	typeof value === "number"
																		? { intValue: String(value) }
																		: { stringValue: value },
															})),
													],
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
		expect(exportedResourceAttributes(payload)).toEqual(
			Object.entries(canonical.resource).map(([key, value]) => ({
				key,
				value: { stringValue: value },
			})),
		);
		await destinationExporters.metrics!.export(
			{ timestamp: canonical.timestamp, observations: [{ name: "up", value: 1 }] },
			activeContext(),
		);
		expect(exportedResourceAttributes(requestFrom(jsonFetch, 1).body)).toContainEqual({
			key: "service.instance.id",
			value: { stringValue: "instance-1" },
		});

		const protobufFetch = fetchProtobufOk();
		vi.stubGlobal("fetch", protobufFetch);
		expect(
			(
				await exporters({ encoding: "protobuf" }).logs!.export([canonical], context)
			)._unsafeUnwrap(),
		).toEqual({ rejectedRecords: 0 });
		expect(rawRequestFrom(protobufFetch).init.body).toEqual(
			encodeOtlpProtobufRequest("logs", payload)._unsafeUnwrap(),
		);
	});

	it.each([false, true])(
		"still redacts raw metadata with resource override=%s",
		async (override) => {
			const fetchMock = fetchOk();
			vi.stubGlobal("fetch", fetchMock);
			await exporters().logs!.export(
				[logEntry({ metadata: { password: "raw-secret", nested: { token: "raw-token" } } })],
				{
					...activeContext(),
					...(override ? { resourceAttributes: HISTORICAL_RESOURCE } : {}),
				},
			);
			const body = String(rawRequestFrom(fetchMock).init.body);
			expect(body).not.toContain("raw-secret");
			expect(body).not.toContain("raw-token");
			expect(body).toContain("[REDACTED]");
		},
	);

	it("uses a credential-free checkpoint key that is stable across auth and encoding changes", () => {
		const original = createOtlpDestination({
			endpoint: "https://collector.example/proxy/otlp/",
			token: "first-secret",
			headers: { "X-Api-Key": "first-key" },
			encoding: "json",
		});
		const rotated = createOtlpDestination({
			endpoint: "https://collector.example/proxy/otlp",
			token: "second-secret",
			headers: { "X-Api-Key": "second-key" },
			encoding: "protobuf",
		});
		const differentEndpoint = createOtlpDestination({
			endpoint: "https://other-collector.example/proxy/otlp",
		});

		expect(original.checkpointKey).toBe(rotated.checkpointKey);
		expect(original.checkpointKey).not.toBe(differentEndpoint.checkpointKey);
		expect(original.checkpointKey).not.toContain("first-secret");
		expect(original.checkpointKey).not.toContain("first-key");
	});

	it("uses historical log resources independently while metrics keep the factory resource", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const destinationExporters = exporters();
		const secondHistoricalResource: ResourceAttributes = {
			"service.name": "content-scheduler",
			region: "ap-southeast-2",
		};

		expect(destinationExporters.logs?.supportsResourceContext).toBe(true);
		await destinationExporters.logs!.export([logEntry()], {
			...activeContext(),
			resourceAttributes: HISTORICAL_RESOURCE,
		});
		await destinationExporters.logs!.export([logEntry()], {
			...activeContext(),
			resourceAttributes: secondHistoricalResource,
		});
		await destinationExporters.logs!.export([logEntry()], activeContext());
		await destinationExporters.metrics!.export(
			{
				timestamp: new Date("2024-06-15T12:00:00.123Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(exportedResourceAttributes(requestFrom(fetchMock, 0).body)).toEqual([
			{ key: "service.name", value: { stringValue: "content-worker" } },
			{ key: "service.instance.id", value: { stringValue: "archived-instance" } },
			{ key: "region", value: { stringValue: "eu-west-1" } },
		]);
		expect(exportedResourceAttributes(requestFrom(fetchMock, 1).body)).toEqual([
			{ key: "service.name", value: { stringValue: "content-scheduler" } },
			{ key: "region", value: { stringValue: "ap-southeast-2" } },
		]);
		expect(exportedResourceAttributes(requestFrom(fetchMock, 2).body)).toEqual(
			exportedResourceAttributes(requestFrom(fetchMock, 3).body),
		);
		expect(exportedResourceAttributes(requestFrom(fetchMock, 2).body)).toContainEqual({
			key: "service.instance.id",
			value: { stringValue: "instance-1" },
		});
	});

	it("uses historical log resources in both JSON and protobuf encodings", async () => {
		const jsonFetch = fetchOk();
		vi.stubGlobal("fetch", jsonFetch);
		await exporters({ encoding: "json" }).logs!.export([logEntry()], {
			...activeContext(),
			resourceAttributes: HISTORICAL_RESOURCE,
		});
		const jsonPayload = requestFrom(jsonFetch).body;

		const protobufFetch = fetchProtobufOk();
		vi.stubGlobal("fetch", protobufFetch);
		await exporters({ encoding: "protobuf" }).logs!.export([logEntry()], {
			...activeContext(),
			resourceAttributes: HISTORICAL_RESOURCE,
		});

		expect(exportedResourceAttributes(jsonPayload)).toEqual([
			{ key: "service.name", value: { stringValue: "content-worker" } },
			{ key: "service.instance.id", value: { stringValue: "archived-instance" } },
			{ key: "region", value: { stringValue: "eu-west-1" } },
		]);
		expect(rawRequestFrom(protobufFetch).init.body).toEqual(
			encodeOtlpProtobufRequest("logs", jsonPayload)._unsafeUnwrap(),
		);
	});
});
