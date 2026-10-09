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
