import { afterEach, describe, expect, it, vi } from "vitest";
import { createOtlpDestination, type OtlpDestinationConfig } from "../destinations/otlp.js";

import {
	activeContext,
	BLUECADET_COMPATIBILITY_RESOURCE,
	exportedResourceAttributes,
	exporters,
	fetchOk,
	logEntry,
	RESOURCE,
	requestFrom,
} from "./otlp-destination.test-utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("createOtlpDestination", () => {
	it.each([
		null,
		undefined,
		42,
		{ name: 42 },
		{ endpoint: "https://collector.example", signals: ["traces"] },
		{ endpoint: "https://collector.example", headers: { "bad header": "private" } },
		{ endpoint: "https://collector.example", headers: { Authorization: "private\nvalue" } },
	])("reports malformed runtime config through create: %#", (config) => {
		const destination = createOtlpDestination(config as OtlpDestinationConfig);
		const result = destination.create({ resourceAttributes: RESOURCE });
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "Invalid OTLP destination configuration",
			retryable: false,
		});
	});

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
		(config, _message) => {
			const result = createOtlpDestination(config).create({ resourceAttributes: RESOURCE });
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toMatchObject({
				message: "Invalid OTLP destination configuration",
				retryable: false,
			});
		},
	);

	it("rejects an unknown encoding without exposing its value", () => {
		const secretEncoding = "private-binary-encoding";
		const invalidConfig: OtlpDestinationConfig = {
			endpoint: "https://collector.example",
			encoding: secretEncoding as never,
		};
		const failure = createOtlpDestination(invalidConfig)
			.create({ resourceAttributes: RESOURCE })
			._unsafeUnwrapErr();
		expect(failure.message).toBe("Invalid OTLP destination configuration");
		expect(failure.message).not.toContain(secretEncoding);
	});

	it("sanitizes invalid token header errors without exposing the token", () => {
		const token = "secret-value\nleak";
		const failure = createOtlpDestination({ endpoint: "https://collector.example", token })
			.create({ resourceAttributes: RESOURCE })
			._unsafeUnwrapErr();
		expect(failure.message).not.toContain("secret-value");
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
