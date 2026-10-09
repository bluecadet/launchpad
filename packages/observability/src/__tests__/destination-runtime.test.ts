import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryQueue } from "../core/delivery-queue.js";
import type {
	DestinationContext,
	DestinationExporters,
	LogExporter,
	MetricBatch,
	MetricExporter,
	ObservabilityDestination,
} from "../core/destination.js";
import { observability } from "../index.js";
import type { DestinationObservabilityConfig } from "../observability-config.js";
import type { ObservabilityState } from "../observability-state.js";

function createContext(
	options: {
		mode?: "task" | "persistent";
		collectMetrics?: PluginContext<ObservabilityState>["collectMetrics"];
	} = {},
) {
	const state: ObservabilityState = { transports: {} };
	const abortController = new AbortController();
	const context: PluginContext<ObservabilityState> = {
		eventBus: createMockEventBus(),
		logger: createMockLogger(),
		abortSignal: abortController.signal,
		cwd: "/",
		mode: options.mode ?? "task",
		getStatusSnapshot: vi.fn().mockReturnValue({
			header: { startTime: new Date(0).toISOString(), uptimeMs: 0, mode: options.mode ?? "task" },
			sections: [],
		}),
		dispatchCommand: vi.fn().mockReturnValue(okAsync(undefined)),
		getGlobalState: vi.fn().mockReturnValue({
			system: { startTime: new Date(1_000), mode: options.mode ?? "task" },
			plugins: {},
			_version: 0,
		}),
		onGlobalStatePatch: vi.fn().mockReturnValue(() => {}),
		collectMetrics: options.collectMetrics,
		updateState: (producer) => producer(state),
	};
	return { context, state };
}

function destination(name: string, exporters: DestinationExporters): ObservabilityDestination {
	return { name, create: () => ok(exporters) };
}

async function setupRuntime(
	destinations: readonly ObservabilityDestination[],
	overrides: Partial<DestinationObservabilityConfig> = {},
	contextOptions: Parameters<typeof createContext>[0] = {},
) {
	const { context, state } = createContext(contextOptions);
	const plugin = observability({ destinations, ...overrides });
	const result = await plugin.setup(context);
	if (result.isErr()) throw result.error;
	return { instance: result.value, context, state };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("destination observability runtime", () => {
	it("rejects mixed modes, invalid resources, and duplicate names before factories run", async () => {
		const create = vi.fn(() => ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } }));
		const configuredDestination: ObservabilityDestination = { name: "same", create };
		const { context } = createContext();

		const mixed = observability({
			resource: {},
			destinations: [configuredDestination],
			transports: [],
		} as never);
		expect((await mixed.setup(context)).isErr()).toBe(true);

		const mixedResource = observability({ transports: [], resource: {} } as never);
		expect((await mixedResource.setup(context)).isErr()).toBe(true);

		const invalidResource = observability({
			resource: { "service.instance.id": "caller-owned" },
			destinations: [configuredDestination],
		});
		expect((await invalidResource.setup(context)).isErr()).toBe(true);

		const nullResource = observability({
			resource: null,
			destinations: [configuredDestination],
		} as never);
		expect((await nullResource.setup(context)).isErr()).toBe(true);

		const duplicates = observability({
			destinations: [configuredDestination, configuredDestination],
		});
		expect((await duplicates.setup(context)).isErr()).toBe(true);
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects removed deployment configuration before destination factories run", async () => {
		const create = vi.fn(() => ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } }));
		const configuredDestination: ObservabilityDestination = { name: "old-config", create };
		const deployment = {
			client: "bluecadet",
			project: "museum",
			installation: "lobby",
			environment: "production",
		};
		const variableConfig = { deployment, destinations: [configuredDestination] };
		const spreadConfig = { ...variableConfig };

		for (const config of [variableConfig, spreadConfig]) {
			const { context } = createContext();
			const result = await observability(config).setup(context);
			expect(result.isErr()).toBe(true);
			if (result.isOk()) continue;
			expect(result.error.message).toContain("use resource attributes");
		}
		expect(create).not.toHaveBeenCalled();
	});

	it("shares one resource per setup and creates a new instance id for the next setup", async () => {
		const firstSetupContexts: DestinationContext[] = [];
		const secondSetupContexts: DestinationContext[] = [];
		const createDestination = (
			name: string,
			contexts: DestinationContext[],
		): ObservabilityDestination => ({
			name,
			create: (destinationContext) => {
				contexts.push(destinationContext);
				return ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } });
			},
		});
		const resource = {
			"service.name": "museum-controller",
			"deployment.environment.name": "production",
			"launchpad.client": "bluecadet",
			"launchpad.project": "museum",
			"launchpad.installation": "lobby",
		};

		const first = await setupRuntime(
			[
				createDestination("first", firstSetupContexts),
				createDestination("second", firstSetupContexts),
			],
			{ resource },
		);
		const second = await setupRuntime([createDestination("third", secondSetupContexts)]);

		expect(firstSetupContexts).toHaveLength(2);
		expect(firstSetupContexts[0]?.resourceAttributes).toBe(
			firstSetupContexts[1]?.resourceAttributes,
		);
		expect(firstSetupContexts[0]?.resourceAttributes).toMatchObject(resource);
		expect(Object.keys(secondSetupContexts[0]?.resourceAttributes ?? {}).sort()).toEqual([
			"service.instance.id",
			"service.name",
		]);
		expect(firstSetupContexts[0]?.resourceAttributes["service.instance.id"]).not.toBe(
			secondSetupContexts[0]?.resourceAttributes["service.instance.id"],
		);

		await first.instance.disconnect?.({ type: "manual" });
		await second.instance.disconnect?.({ type: "manual" });
	});

	it("keeps the legacy transport configuration unchanged", async () => {
		const push = vi.fn(() => okAsync(undefined));
		const { context } = createContext();
		const plugin = observability({
			transports: [{ name: "legacy", push }],
			batch: { maxEntries: 1, intervalMs: 60_000 },
		});

		const result = await plugin.setup(context);
		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		context.eventBus.emit("log:info", { message: "legacy", args: [], module: "app" });
		await result.value.executeCommand?.({ type: "observability.flush" });
		expect(push).toHaveBeenCalledOnce();
		await result.value.disconnect?.({ type: "manual" });
	});

	it("rejects empty names and destinations without capabilities and cleans created bundles", async () => {
		const shutdown = vi.fn(() => okAsync(undefined));
		const { context } = createContext();
		const emptyName = observability({
			destinations: [{ name: "  ", create: () => ok({}) }],
		});
		expect((await emptyName.setup(context)).isErr()).toBe(true);

		const noCapabilities = observability({
			destinations: [destination("empty", { shutdown })],
		});
		expect((await noCapabilities.setup(context)).isErr()).toBe(true);
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("routes logs and metrics only to destinations with the matching capability", async () => {
		const exportLogs = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, context } = await setupRuntime(
			[
				destination("logs", { logs: { export: exportLogs } }),
				destination("metrics", { metrics: { export: exportMetrics } }),
			],
			{ batch: { maxEntries: 1, intervalMs: 60_000 } },
			{ collectMetrics: () => [{ name: "app.temperature", value: 21 }] },
		);

		context.eventBus.emit("log:info", { message: "hello", args: [], module: "app" });
		await instance.ready?.();
		await instance.executeCommand?.({ type: "observability.flush" });

		expect(exportLogs).toHaveBeenCalledOnce();
		expect(exportMetrics).toHaveBeenCalledOnce();
		expect(exportLogs.mock.calls[0]?.[0]?.[0]?.message).toBe("hello");
		expect(exportMetrics.mock.calls[0]?.[0].observations).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "app.temperature", value: 21 })]),
		);
		await instance.disconnect?.({ type: "manual" });
	});

	it("filters malformed observations without suppressing later valid observations", async () => {
		const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const throwingObservation = Object.defineProperty({}, "name", {
			get: () => {
				throw new Error("hostile getter");
			},
		});
		const formerlyReservedAttributes = {
			"deployment.environment.name": "production",
			"launchpad.client": "bluecadet",
			"launchpad.project": "museum",
			"launchpad.installation": "lobby",
		};
		const malformed = [
			{ name: "valid.gauge", value: 4, attributes: { room: "gallery" } },
			{ name: "valid.identity_dimensions", value: 1, attributes: formerlyReservedAttributes },
			null,
			{ name: "bad gauge", value: 1 },
			{ name: "not.finite", value: Number.NaN },
			{ name: "bad.unit", value: 1, unit: 12 },
			{ name: "reserved", value: 1, attributes: { "service.name": "override" } },
			throwingObservation,
			{ name: "valid.after_bad", value: 5 },
		] as unknown as readonly MetricObservation[];
		const { instance } = await setupRuntime(
			[destination("metrics", { metrics: { export: exportMetrics } })],
			{},
			{ collectMetrics: () => malformed },
		);

		await instance.ready?.();
		const batch = exportMetrics.mock.calls[0]?.[0] as MetricBatch;
		const names = batch.observations.map((observation) => observation.name);
		expect(names).toContain("valid.gauge");
		expect(batch.observations).toContainEqual({
			name: "valid.identity_dimensions",
			value: 1,
			attributes: formerlyReservedAttributes,
		});
		expect(names).not.toContain("bad gauge");
		expect(names).not.toContain("not.finite");
		expect(names).not.toContain("reserved");
		expect(names).not.toContain("bad.unit");
		expect(names).toContain("valid.after_bad");
		expect(names).toContain("launchpad.runtime.start_time");
		expect(names).toContain("launchpad.runtime.uptime");
		await instance.disconnect?.({ type: "manual" });
	});

	it("keeps delivery metric dimensions when resource attributes use the same keys", async () => {
		const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const { instance } = await setupRuntime(
			[destination("metrics", { metrics: { export: exportMetrics } })],
			{ resource: { destination: "resource-destination", signal: "resource-signal" } },
		);

		await instance.ready?.();
		const observations = exportMetrics.mock.calls[0]?.[0].observations;
		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "launchpad.observability.delivery.pushed_total",
					attributes: { destination: "metrics", signal: "metrics" },
				}),
			]),
		);
		await instance.disconnect?.({ type: "manual" });
	});

	it("collects once in task mode and periodically in persistent mode", async () => {
		vi.useFakeTimers();
		const taskExport = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const task = await setupRuntime(
			[destination("task", { metrics: { export: taskExport } })],
			{ metrics: { intervalMs: 100 } },
			{ mode: "task" },
		);
		await task.instance.ready?.();
		await vi.advanceTimersByTimeAsync(500);
		expect(taskExport).toHaveBeenCalledTimes(1);
		await task.instance.disconnect?.({ type: "manual" });

		const persistentExport = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const persistent = await setupRuntime(
			[destination("persistent", { metrics: { export: persistentExport } })],
			{ metrics: { intervalMs: 100 } },
			{ mode: "persistent" },
		);
		await persistent.instance.ready?.();
		await vi.advanceTimersByTimeAsync(250);
		expect(persistentExport).toHaveBeenCalledTimes(3);
		await persistent.instance.disconnect?.({ type: "manual" });
	});

	it("keeps metrics independent from log filters and guards observability events recursively", async () => {
		const exportLogs = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, context } = await setupRuntime(
			[destination("both", { logs: { export: exportLogs }, metrics: { export: exportMetrics } })],
			{ include: ["*"], exclude: ["log:*"], batch: { maxEntries: 1, intervalMs: 60_000 } },
		);

		context.eventBus.emit("observability:internal" as "log:info", {} as never);
		context.eventBus.emit("log:info", { message: "ignored", args: [], module: "app" });
		await instance.ready?.();
		await instance.executeCommand?.({ type: "observability.flush" });
		expect(exportLogs).not.toHaveBeenCalled();
		expect(exportMetrics).toHaveBeenCalledOnce();
		await instance.disconnect?.({ type: "manual" });
	});

	it("accounts for partial rejection without retrying accepted records", async () => {
		const deliver = vi.fn(() => okAsync({ rejectedRecords: 1 }));
		const onSuccess = vi.fn();
		const onDrop = vi.fn();
		const queue = new DeliveryQueue<readonly number[]>({
			mode: "retry",
			maxQueuedBatches: 2,
			maxRetries: 3,
			deliveryTimeoutMs: 100,
			countRecords: (records) => records.length,
			deliver,
			onSuccess,
			onDrop,
		});

		queue.enqueue([1, 2, 3]);
		await queue.flush(100);
		expect(deliver).toHaveBeenCalledOnce();
		expect(onSuccess).toHaveBeenCalledWith(2, 1);
		expect(onDrop).toHaveBeenCalledWith(1, "rejected");
	});

	it("times out uncooperative exporters and bounds queued batches", async () => {
		vi.useFakeTimers();
		const never = new Promise<never>(() => {});
		const onDrop = vi.fn();
		const queue = new DeliveryQueue<readonly number[]>({
			mode: "retry",
			maxQueuedBatches: 1,
			maxRetries: 0,
			deliveryTimeoutMs: 50,
			countRecords: (records) => records.length,
			deliver: () => ResultAsync.fromPromise(never, () => new Error("unreachable")),
			onDrop,
		});

		queue.enqueue([1]);
		queue.enqueue([2]);
		queue.enqueue([3, 4]);
		expect(queue.queuedBatches).toBe(1);
		expect(onDrop).toHaveBeenCalledWith(1, "queue-full");
		await vi.advanceTimersByTimeAsync(100);
		expect(onDrop).toHaveBeenCalledWith(1, "max-retries");
	});

	it("coalesces pending gauge snapshots to the newest batch", async () => {
		let finishFirst = () => {};
		const first = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const delivered: number[] = [];
		const deliver = vi.fn((value: number) =>
			value === 1
				? ResultAsync.fromPromise(
						first.then(() => ({ rejectedRecords: 0 })),
						() => new Error(),
					)
				: okAsync({ rejectedRecords: 0 }),
		);
		const queue = new DeliveryQueue<number>({
			mode: "coalesce",
			maxQueuedBatches: 10,
			maxRetries: 0,
			deliveryTimeoutMs: 100,
			countRecords: () => 1,
			deliver: (value) => {
				delivered.push(value);
				return deliver(value);
			},
		});

		queue.enqueue(1);
		queue.enqueue(2);
		queue.enqueue(3);
		finishFirst();
		await queue.flush(100);
		expect(delivered).toEqual([1, 3]);
	});

	it("uses one absolute deadline for queue drain and shutdown hooks", async () => {
		vi.useFakeTimers();
		const never = new Promise<never>(() => {});
		const shutdown = vi.fn(() => ResultAsync.fromPromise(never, () => new Error()));
		const { instance } = await setupRuntime(
			[
				destination("blocked", {
					metrics: {
						export: () => ResultAsync.fromPromise(never, () => new Error()),
					},
					shutdown,
				}),
			],
			{ delivery: { shutdownTimeoutMs: 100, deliveryTimeoutMs: 1_000 } },
		);
		await instance.ready?.();
		const disconnect = instance.disconnect?.({ type: "manual" });
		await vi.advanceTimersByTimeAsync(100);
		const result = await disconnect;
		expect(result?.isErr()).toBe(true);
		expect(shutdown).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
	});

	it("runs one bounded shutdown and contains thrown shutdown implementations", async () => {
		const shutdown = vi.fn(() => {
			throw new Error("secret=https://user:pass@example.test/body");
		});
		const { instance } = await setupRuntime([
			destination("shutdown", {
				logs: { export: () => okAsync({ rejectedRecords: 0 }) },
				shutdown,
			}),
		]);

		const result = await instance.disconnect?.({ type: "manual" });
		expect(result?.isErr()).toBe(true);
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("quarantines an exporter that ignores abort and ignores its late success", async () => {
		vi.useFakeTimers();
		let settleFirst = (_result: { rejectedRecords: number }) => {};
		const first = new Promise<{ rejectedRecords: number }>((resolve) => {
			settleFirst = resolve;
		});
		const delivered: number[] = [];
		const onSuccess = vi.fn();
		const queue = new DeliveryQueue<number>({
			mode: "coalesce",
			maxQueuedBatches: 2,
			maxRetries: 0,
			deliveryTimeoutMs: 50,
			countRecords: () => 1,
			deliver: (value) => {
				delivered.push(value);
				return value === 1
					? ResultAsync.fromPromise(first, () => new Error())
					: okAsync({ rejectedRecords: 0 });
			},
			onSuccess,
		});

		queue.enqueue(1);
		queue.enqueue(2);
		await vi.advanceTimersByTimeAsync(50);
		expect(delivered).toEqual([1]);
		settleFirst({ rejectedRecords: 0 });
		await vi.advanceTimersByTimeAsync(0);
		expect(delivered).toEqual([1, 2]);
		expect(onSuccess).toHaveBeenCalledTimes(1);
	});

	it("does not mark a fully rejected export as successful", async () => {
		const { instance, context, state } = await setupRuntime(
			[destination("rejecting", { logs: { export: () => okAsync({ rejectedRecords: 1 }) } })],
			{ batch: { maxEntries: 1, intervalMs: 60_000 } },
		);
		context.eventBus.emit("log:info", { message: "rejected", args: [], module: "app" });
		await instance.executeCommand?.({ type: "observability.flush" });

		const signal = state.destinations?.rejecting?.logs;
		expect(signal?.status).toBe("failing");
		expect(signal?.lastError).toBe("Destination rejected all records");
		expect(signal?.lastSuccessAt).toBeNull();
		expect(signal?.totalPushed).toBe(0);
		expect(signal?.totalDropped).toBe(1);
		await instance.disconnect?.({ type: "manual" });
	});

	it("moves a previously healthy signal to failing after a total rejection", async () => {
		let exportCount = 0;
		const exportLogs: LogExporter["export"] = () => {
			exportCount += 1;
			return okAsync({ rejectedRecords: exportCount === 1 ? 0 : 1 });
		};
		const { instance, context, state } = await setupRuntime(
			[destination("sometimes-rejecting", { logs: { export: exportLogs } })],
			{ batch: { maxEntries: 1, intervalMs: 60_000 } },
		);

		context.eventBus.emit("log:info", { message: "accepted", args: [], module: "app" });
		await instance.executeCommand?.({ type: "observability.flush" });
		const firstSuccessAt = state.destinations?.["sometimes-rejecting"]?.logs?.lastSuccessAt;
		expect(state.destinations?.["sometimes-rejecting"]?.logs?.status).toBe("ok");

		context.eventBus.emit("log:info", { message: "rejected", args: [], module: "app" });
		await instance.executeCommand?.({ type: "observability.flush" });
		const signal = state.destinations?.["sometimes-rejecting"]?.logs;
		expect(signal?.status).toBe("failing");
		expect(signal?.lastError).toBe("Destination rejected all records");
		expect(signal?.lastSuccessAt).toBe(firstSuccessAt);
		expect(signal?.totalPushed).toBe(1);
		expect(signal?.totalDropped).toBe(1);
		await instance.disconnect?.({ type: "manual" });
	});

	it.each([Number.NaN, -1, 1.5, 3])(
		"treats invalid rejectedRecords %s as a permanent invalid acknowledgement",
		async (rejectedRecords) => {
			const deliver = vi.fn(() => okAsync({ rejectedRecords }));
			const onSuccess = vi.fn();
			const onDrop = vi.fn();
			const queue = new DeliveryQueue<readonly number[]>({
				mode: "retry",
				maxQueuedBatches: 2,
				maxRetries: 3,
				deliveryTimeoutMs: 100,
				countRecords: (records) => records.length,
				deliver,
				onSuccess,
				onDrop,
			});
			queue.enqueue([1, 2]);
			await queue.flush(100);
			expect(deliver).toHaveBeenCalledOnce();
			expect(onSuccess).not.toHaveBeenCalled();
			expect(onDrop).toHaveBeenCalledWith(2, "invalid-ack");
		},
	);

	it("does not retry explicit non-retryable failures", async () => {
		const failure = Object.assign(new Error("bad request"), { retryable: false });
		const deliver = vi.fn(() => errAsync(failure));
		const queue = new DeliveryQueue<number>({
			mode: "retry",
			maxQueuedBatches: 2,
			maxRetries: 3,
			deliveryTimeoutMs: 100,
			countRecords: () => 1,
			deliver,
		});

		queue.enqueue(1);
		await queue.flush(100);
		expect(deliver).toHaveBeenCalledOnce();
	});
});
