import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryQueue, type DeliveryQueueOptions } from "../core/delivery-queue.js";
import { DestinationFailure } from "../core/export-failure.js";
import { projectObservabilityMetrics } from "../observability-metrics.js";
import { type ObservabilityState, ObservabilityStateManager } from "../observability-state.js";

function harness(deliver: DeliveryQueueOptions<readonly number[]>["deliver"], maxRetries = 1) {
	const store = new PatchedStateManager<ObservabilityState>();
	const manager = new ObservabilityStateManager((producer) => store.updateState(producer));
	manager.initDestination("backend:with:colons", ["logs"]);
	const snapshots: ObservabilityState[] = [];
	store.onPatch(() => snapshots.push(structuredClone(store.state)));
	const queue = new DeliveryQueue<readonly number[]>({
		mode: "retry",
		maxQueuedBatches: 1,
		maxRetries,
		deliveryTimeoutMs: 100,
		countRecords: (records) => records.length,
		deliver,
		onTransition: (transition) =>
			manager.applyDestinationTransition("backend:with:colons", "logs", transition),
	});
	return {
		queue,
		store,
		snapshots,
		signal: () => store.state.destinations!["backend:with:colons"]!.logs!,
	};
}

afterEach(() => vi.useRealTimers());

describe("atomic destination delivery state", () => {
	it("publishes durable gaps with batch depth and projects source counters from that state", () => {
		const store = new PatchedStateManager<ObservabilityState>();
		const manager = new ObservabilityStateManager((producer) => store.updateState(producer));
		manager.initDestination("archive", ["logs", "metrics"], { durableLogs: true });
		const snapshots: ObservabilityState[] = [];
		store.onPatch(() => snapshots.push(structuredClone(store.state)));
		manager.applyDestinationTransition("archive", "logs", {
			type: "source-batch",
			queuedBatches: 1,
			lostRecords: 4,
			unknownGaps: 2,
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.destinations?.archive?.logs).toMatchObject({
			queueSize: 1,
			totalSourceRecordsLost: 4,
			totalUnknownSourceGaps: 2,
			totalDropped: 0,
		});
		expect(
			projectObservabilityMetrics(store.state).filter((metric) =>
				metric.name.startsWith("launchpad.observability.source."),
			),
		).toEqual([
			{
				name: "launchpad.observability.source.records_lost_total",
				value: 4,
				attributes: { destination: "archive", signal: "logs" },
			},
			{
				name: "launchpad.observability.source.unknown_gaps_total",
				value: 2,
				attributes: { destination: "archive", signal: "logs" },
			},
		]);
	});

	it("parks durable receipts atomically without recording a delivery loss", () => {
		const store = new PatchedStateManager<ObservabilityState>();
		const manager = new ObservabilityStateManager((producer) => store.updateState(producer));
		manager.initDestination("archive", ["logs"], { durableLogs: true });
		manager.applyDestinationTransition("archive", "logs", {
			type: "source-batch",
			queuedBatches: 1,
			lostRecords: 0,
			unknownGaps: 0,
		});
		const snapshots: ObservabilityState[] = [];
		store.onPatch(() => snapshots.push(structuredClone(store.state)));
		manager.applyDestinationTransition("archive", "logs", {
			type: "source",
			status: "parked",
			queuedBatches: 0,
			error: new Error("Destination delivery timed out: private-token"),
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.destinations?.archive?.logs).toMatchObject({
			queueSize: 0,
			sourceStatus: "parked",
			status: "failing",
			totalDropped: 0,
			lastError: "Destination exporter failed (Error)",
		});
	});

	it("publishes retry depth and degraded status together, then a terminal drop together", async () => {
		vi.useFakeTimers();
		const { queue, signal, snapshots } = harness(() => errAsync(new Error("network failed")));
		queue.enqueue([1]);
		await vi.advanceTimersByTimeAsync(0);
		expect(signal()).toMatchObject({ status: "degraded", queueSize: 1, totalDropped: 0 });
		expect(
			snapshots.some(
				(state) => state.destinations!["backend:with:colons"]!.logs!.status === "failing",
			),
		).toBe(false);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(signal()).toMatchObject({ status: "failing", queueSize: 0, totalDropped: 1 });
		const failures = snapshots
			.map((state) => state.destinations!["backend:with:colons"]!.logs!)
			.filter((state) => state.status === "failing");
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ queueSize: 0, totalDropped: 1 });
		queue.stop();
	});

	it("publishes accepted and rejected records in one patch and projects that same state", async () => {
		const { queue, store, signal, snapshots } = harness(() => okAsync({ rejectedRecords: 1 }));
		queue.enqueue([1, 2, 3]);
		snapshots.length = 0;
		await queue.flush(100);
		expect(snapshots).toHaveLength(1);
		expect(signal()).toMatchObject({
			status: "degraded",
			queueSize: 0,
			totalPushed: 2,
			totalDropped: 1,
		});
		const attributes = { destination: "backend:with:colons", signal: "logs" };
		expect(projectObservabilityMetrics(store.state)).toEqual([
			{ name: "launchpad.observability.delivery.pushed_total", value: 2, attributes },
			{ name: "launchpad.observability.delivery.dropped_total", value: 1, attributes },
			{ name: "launchpad.observability.delivery.queue_batches", value: 0, attributes },
			{
				name: "launchpad.observability.delivery.last_success_timestamp",
				value: signal().lastSuccessAt!.getTime(),
				unit: "ms",
				attributes,
			},
		]);
		queue.stop();
	});

	it("includes retry eviction losses in the same failed-attempt transition", async () => {
		vi.useFakeTimers();
		const { queue, signal, snapshots } = harness(() => errAsync(new Error("network failed")));
		queue.enqueue([1]);
		queue.enqueue([2, 3]);
		snapshots.length = 0;
		await vi.advanceTimersByTimeAsync(0);
		expect(snapshots).toHaveLength(1);
		expect(signal()).toMatchObject({ status: "degraded", queueSize: 1, totalDropped: 2 });
		queue.stop();
	});

	it("does not trust a custom error's timeout prefix or name", async () => {
		const failure = Object.assign(
			new Error("Destination delivery timed out: Bearer sensitive-token"),
			{
				name: "sensitive-token",
				retryable: false,
			},
		);
		const { queue, signal } = harness(() => errAsync(failure));
		queue.enqueue([1]);
		await queue.flush(100);
		expect(signal().lastError).toBe("Destination exporter failed (Error)");
		queue.stop();
	});

	it("preserves deliberately safe built-in diagnostics", async () => {
		const { queue, signal } = harness(() =>
			errAsync(
				new DestinationFailure("OTLP request failed with HTTP status 401", { retryable: false }),
			),
		);
		queue.enqueue([1]);
		await queue.flush(100);
		expect(signal().lastError).toBe("OTLP request failed with HTTP status 401");
		queue.stop();
	});

	it("omits absent delivery state and timestamps before any accepted records", () => {
		expect(projectObservabilityMetrics(undefined)).toEqual([]);
		expect(projectObservabilityMetrics({ transports: {} })).toEqual([]);
		const { store, queue } = harness(() => okAsync({ rejectedRecords: 0 }));
		expect(projectObservabilityMetrics(store.state)).toHaveLength(3);
		queue.stop();
	});
});
