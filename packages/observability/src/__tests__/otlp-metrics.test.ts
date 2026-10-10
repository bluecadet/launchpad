import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activeContext,
	exportedMetrics,
	exporters,
	fetchOk,
	requestFrom,
} from "./otlp-destination.test-utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
