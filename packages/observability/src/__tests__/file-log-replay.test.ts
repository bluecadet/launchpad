import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type {
	LoggerSource,
	LoggerSourceReader,
	LogSourceBatch,
	LogSourceGap,
	NormalizedLogRecord,
	ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { normalizeLogRecord } from "@bluecadet/launchpad-utils/logging";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DestinationContext,
	LogExporter,
	MetricExporter,
	ObservabilityDestination,
} from "../core/destination.js";
import { observability } from "../index.js";
import type { LogStorageConfig } from "../observability-config.js";
import type { ObservabilityState } from "../observability-state.js";

type CanonicalExporter = NonNullable<LogExporter["exportCanonical"]>;

function abortError(): Error {
	return Object.assign(new Error("aborted"), { name: "AbortError" });
}

class FakeLogSource implements LoggerSource {
	readonly identity = {
		sourceId: "installation-log",
		runtimeId: "runtime-123",
		baseResourceAttributes: Object.freeze({ "service.name": "launchpad" }),
	};
	readonly status = {
		available: true,
		pendingRecords: 0,
		droppedRecords: 0,
		lossEvents: 0,
	};
	resourceAttributes: ResourceAttributes = this.identity.baseResourceAttributes;
	readonly checkpointOffsets = new Map<string, number>();
	readonly acknowledgements: Array<{ checkpointId: string; receipt: string }> = [];
	readonly readers: string[] = [];
	readonly closedReaders: string[] = [];
	gaps: readonly LogSourceGap[] = [];
	holdUnboundedReads = false;
	returnEmptyReads = false;
	readCount = 0;
	beforeAck: (() => ResultAsync<void, Error>) | undefined;
	onFlush: ((barrier: string) => void) | undefined;
	private readonly records: NormalizedLogRecord[];
	private readonly waiters = new Set<() => void>();

	constructor(records: readonly NormalizedLogRecord[] = []) {
		this.records = [...records];
	}

	configureResourceAttributes(attributes: ResourceAttributes): void {
		this.resourceAttributes = Object.freeze({ ...attributes });
	}

	append(record: NormalizedLogRecord): void {
		this.records.push(record);
		for (const wake of this.waiters) wake();
		this.waiters.clear();
	}

	flush(_signal: AbortSignal): ResultAsync<string, Error> {
		const barrier = String(this.records.length);
		this.onFlush?.(barrier);
		return okAsync(barrier);
	}

	createReader(
		identity: { readonly checkpointId: string },
		_signal: AbortSignal,
	): ResultAsync<LoggerSourceReader, Error> {
		const checkpointId = identity.checkpointId;
		this.readers.push(checkpointId);
		let outstandingReceipt: string | null = null;
		let reportedGaps = false;
		return okAsync({
			read: (request) =>
				new ResultAsync(
					(async (): Promise<Result<LogSourceBatch, Error>> => {
						if (outstandingReceipt) return err(new Error("one receipt is already outstanding"));
						this.readCount += 1;
						while (true) {
							if (request.signal.aborted) return err(abortError());
							const offset = this.checkpointOffsets.get(checkpointId) ?? 0;
							const through = request.through === undefined ? null : Number(request.through);
							const end =
								through === null ? this.records.length : Math.min(this.records.length, through);
							if (!this.holdUnboundedReads || through !== null) {
								const records = this.records.slice(
									offset,
									Math.min(end, offset + request.maxEntries),
								);
								if (
									this.returnEmptyReads ||
									records.length > 0 ||
									(through !== null && offset >= through)
								) {
									const nextOffset = offset + records.length;
									outstandingReceipt = `${offset}:${nextOffset}`;
									const batchGaps = reportedGaps ? [] : this.gaps;
									reportedGaps = true;
									return ok({
										records,
										gaps: batchGaps,
										receipt: outstandingReceipt,
										reachedThrough: through !== null && nextOffset >= through,
									});
								}
							}
							await new Promise<void>((resolve) => {
								const wake = () => {
									request.signal.removeEventListener("abort", onAbort);
									resolve();
								};
								const onAbort = () => {
									this.waiters.delete(wake);
									resolve();
								};
								this.waiters.add(wake);
								request.signal.addEventListener("abort", onAbort, { once: true });
							});
						}
					})(),
				),
			ack: (receipt) =>
				new ResultAsync(
					(async () => {
						if (receipt !== outstandingReceipt) return err(new Error("invalid receipt"));
						const result = await this.beforeAck?.();
						if (result?.isErr()) return result;
						const nextOffset = Number(receipt.split(":")[1]);
						this.checkpointOffsets.set(checkpointId, nextOffset);
						this.acknowledgements.push({ checkpointId, receipt });
						outstandingReceipt = null;
						return ok(undefined);
					})(),
				),
			close: () => {
				this.closedReaders.push(checkpointId);
				return okAsync(undefined);
			},
		});
	}
}

function record(
	message: string,
	resource: ResourceAttributes = { "service.name": "historical", "service.instance.id": "old" },
	event = "log:info",
): NormalizedLogRecord {
	return normalizeLogRecord(
		{
			timestamp: new Date("2025-01-01T00:00:00.000Z"),
			level: event.startsWith("log:") ? "info" : "event",
			message,
			event,
			module: "app",
			metadata: { message },
		},
		resource,
	)._unsafeUnwrap();
}

function createContext(source?: LoggerSource) {
	const state: ObservabilityState = { transports: {} };
	const snapshots: ObservabilityState[] = [];
	const context: PluginContext<ObservabilityState> = {
		eventBus: createMockEventBus(),
		logger: createMockLogger(),
		...(source === undefined ? {} : { logSource: source }),
		abortSignal: new AbortController().signal,
		cwd: "/",
		mode: "task",
		getStatusSnapshot: vi.fn().mockReturnValue({
			header: { startTime: new Date(0).toISOString(), uptimeMs: 0, mode: "task" },
			sections: [],
		}),
		dispatchCommand: vi.fn().mockReturnValue(okAsync(undefined)),
		getGlobalState: vi.fn().mockReturnValue({
			system: { startTime: new Date(0), mode: "task" },
			plugins: {},
			_version: 0,
		}),
		onGlobalStatePatch: vi.fn().mockReturnValue(() => {}),
		updateState: (producer) => {
			producer(state);
			snapshots.push(structuredClone(state));
		},
	};
	return { context, state, snapshots };
}

function fileDestination(
	name: string,
	exportLogs: CanonicalExporter,
	extras: { metrics?: MetricExporter; checkpointKey?: string } = {},
): ObservabilityDestination {
	return {
		name,
		checkpointKey: extras.checkpointKey ?? `route-${name}`,
		create: () =>
			ok({
				logs: {
					export: () => errAsync(new Error("Raw export must not be called")),
					exportCanonical: exportLogs,
				},
				...(extras.metrics === undefined ? {} : { metrics: extras.metrics }),
			}),
	};
}

async function setupFileRuntime(
	source: LoggerSource | undefined,
	destinations: readonly ObservabilityDestination[],
	overrides: {
		include?: string[];
		exclude?: string[];
		deliveryTimeoutMs?: number;
		intervalMs?: number;
		logStorage?: LogStorageConfig;
	} = {},
) {
	const { context, state, snapshots } = createContext(source);
	const result = await observability({
		destinations,
		...(overrides.logStorage === undefined ? {} : { logStorage: overrides.logStorage }),
		...(overrides.include === undefined ? {} : { include: overrides.include }),
		...(overrides.exclude === undefined ? {} : { exclude: overrides.exclude }),
		batch: { maxEntries: 100, intervalMs: overrides.intervalMs ?? 60_000 },
		buffer: { maxBatches: 50, maxRetries: 1 },
		delivery: {
			deliveryTimeoutMs: overrides.deliveryTimeoutMs ?? 100,
			shutdownTimeoutMs: 100,
			maxQueuedBatches: 10,
		},
	}).setup(context);
	if (result.isErr()) throw result.error;
	return { instance: result.value, context, state, snapshots };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("file-backed destination log replay", () => {
	it("preserves the canonical exporter receiver without invoking raw export", async () => {
		const source = new FakeLogSource([record("canonical-only")]);
		const rawExport = vi.fn<LogExporter["export"]>(() => errAsync(new Error("raw export called")));
		const logs: LogExporter = {
			export: rawExport,
			exportCanonical(batch, context) {
				expect(this).toBe(logs);
				expect(batch.records[0]?.message).toBe("canonical-only");
				expect(batch.resourceAttributes).toEqual(batch.records[0]?.resource);
				expect(context.signal.aborted).toBe(false);
				return okAsync({ rejectedRecords: 0 });
			},
		};
		const { instance } = await setupFileRuntime(source, [
			{
				name: "receiver",
				checkpointKey: "receiver-route",
				create: () => ok({ logs }),
			},
		]);
		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(rawExport).not.toHaveBeenCalled();
		await instance.disconnect?.({ type: "manual" });
	});

	it("acknowledges total rejection once without reporting a successful export", async () => {
		const source = new FakeLogSource([record("rejected")]);
		const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 1 }));
		const { instance, state } = await setupFileRuntime(source, [
			fileDestination("rejected", exportLogs),
		]);
		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(state.destinations?.rejected?.logs).toMatchObject({
			totalPushed: 0,
			totalDropped: 1,
			status: "failing",
			queueSize: 0,
			lastSuccessAt: null,
			lastError: "Destination rejected all records",
		});
		expect(exportLogs).toHaveBeenCalledOnce();
		await instance.disconnect?.({ type: "manual" });
	});

	it("does not expose spoofed timeout messages from a durable exporter", async () => {
		const source = new FakeLogSource([record("retained")]);
		const { instance, state, context } = await setupFileRuntime(source, [
			fileDestination("private", () =>
				errAsync(
					Object.assign(new Error("Destination delivery timed out: secret-token"), {
						retryable: false,
					}),
				),
			),
		]);
		await vi.waitFor(() => expect(state.destinations?.private?.logs?.sourceStatus).toBe("parked"));
		expect(state.destinations?.private?.logs?.lastError).toBe(
			"Destination exporter failed (Error)",
		);
		expect(JSON.stringify(vi.mocked(context.logger.warn).mock.calls)).not.toContain("secret-token");
		expect(source.acknowledgements).toHaveLength(0);
		await instance.disconnect?.({ type: "manual" });
	});
	it.each(["open", "read", "read-abort", "flush", "close", "configure"] as const)(
		"keeps %s source failures in source status without memory fallback",
		async (failure) => {
			const source = new FakeLogSource();
			const error = failure === "read-abort" ? abortError() : new Error("private source failure");
			const createReader = source.createReader.bind(source);
			if (failure === "configure") {
				vi.spyOn(source, "configureResourceAttributes").mockImplementation(() => {
					throw error;
				});
			} else if (failure === "open") {
				vi.spyOn(source, "createReader").mockReturnValue(errAsync(error));
			} else if (failure === "read" || failure === "read-abort" || failure === "close") {
				vi.spyOn(source, "createReader").mockImplementation((identity, signal) =>
					createReader(identity, signal).map((reader) => ({
						...reader,
						...(failure === "close"
							? { close: () => errAsync(error) }
							: { read: () => errAsync(error) }),
					})),
				);
			} else {
				vi.spyOn(source, "flush").mockReturnValue(errAsync(error));
			}
			const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
			const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
			const { instance, context, state } = await setupFileRuntime(source, [
				fileDestination("source-failure", exportLogs, { metrics: { export: exportMetrics } }),
			]);
			await instance.ready?.();
			context.eventBus.emit("log:info", { message: "never-memory", args: [], module: "app" });
			if (failure === "close") await instance.disconnect?.({ type: "manual" });
			else await instance.executeCommand?.({ type: "observability.flush" });
			await vi.waitFor(() =>
				expect(state.destinations?.["source-failure"]?.logs?.sourceStatus).toBe(
					failure === "read" || failure === "read-abort" ? "parked" : "unavailable",
				),
			);
			expect(state.destinations?.["source-failure"]?.logs?.lastError).not.toContain("private");
			expect(exportLogs).not.toHaveBeenCalled();
			expect(exportMetrics).toHaveBeenCalled();
			expect(context.eventBus.onAny).not.toHaveBeenCalled();
			await instance.disconnect?.({ type: "manual" });
		},
	);

	it.each([-1, 0.5, 2, Number.NaN])(
		"parks invalid canonical acknowledgement %s without advancing receipt",
		async (rejectedRecords) => {
			const source = new FakeLogSource([record("retained")]);
			const exporter = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords }));
			const { instance, state } = await setupFileRuntime(source, [
				fileDestination("invalid", exporter),
			]);
			await vi.waitFor(() =>
				expect(state.destinations?.invalid?.logs?.sourceStatus).toBe("parked"),
			);
			expect(source.acknowledgements).toHaveLength(0);
			expect(state.destinations?.invalid?.logs?.totalDropped).toBe(0);
			expect(exporter).toHaveBeenCalledOnce();
			await instance.disconnect?.({ type: "manual" });
		},
	);

	it("polls an idle source at the configured interval and flush wakes it immediately", async () => {
		vi.useFakeTimers();
		const source = new FakeLogSource();
		source.returnEmptyReads = true;
		const { instance } = await setupFileRuntime(
			source,
			[fileDestination("idle", () => okAsync({ rejectedRecords: 0 }))],
			{ intervalMs: 1_000 },
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(source.readCount).toBe(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(source.readCount).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(source.readCount).toBe(2);
		await instance.executeCommand?.({ type: "observability.flush" });
		expect(source.readCount).toBeGreaterThan(2);
		await instance.disconnect?.({ type: "manual" });
	});

	it("does not enter an idle wait when a barrier arrived during acknowledgement", async () => {
		vi.useFakeTimers();
		const source = new FakeLogSource();
		source.returnEmptyReads = true;
		let releaseAck = () => {};
		source.beforeAck = () =>
			ResultAsync.fromSafePromise(
				new Promise<void>((resolve) => {
					releaseAck = resolve;
				}),
			);
		const { instance } = await setupFileRuntime(source, [
			fileDestination("idle-race", () => okAsync({ rejectedRecords: 0 })),
		]);
		await vi.advanceTimersByTimeAsync(0);
		const flushed = instance.executeCommand?.({ type: "observability.flush" });
		await vi.advanceTimersByTimeAsync(0);
		source.beforeAck = undefined;
		releaseAck();
		await vi.advanceTimersByTimeAsync(0);
		expect(source.readCount).toBeGreaterThan(1);
		await flushed;
		await instance.disconnect?.({ type: "manual" });
	});

	it("honors Retry-After beyond the exponential retry cap without acknowledging early", async () => {
		vi.useFakeTimers();
		const source = new FakeLogSource([record("retry-after")]);
		const exportLogs = vi
			.fn<CanonicalExporter>()
			.mockImplementationOnce(() =>
				errAsync(Object.assign(new Error("busy"), { retryable: true, retryAfterMs: 45_000 })),
			)
			.mockImplementation(() => okAsync({ rejectedRecords: 0 }));
		const { instance } = await setupFileRuntime(source, [
			fileDestination("retry-after", exportLogs),
		]);
		await vi.advanceTimersByTimeAsync(44_999);
		expect(exportLogs).toHaveBeenCalledOnce();
		expect(source.acknowledgements).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(exportLogs).toHaveBeenCalledTimes(2);
		expect(source.acknowledgements).toHaveLength(1);
		await instance.disconnect?.({ type: "manual" });
	});

	it("retries only the failed contiguous resource group before acknowledging the whole receipt", async () => {
		const oldResource = { "service.instance.id": "old" };
		const newResource = { "service.instance.id": "new" };
		const source = new FakeLogSource([
			record("first", oldResource),
			record("second", newResource),
			record("third", oldResource),
		]);
		let failed = false;
		const exportLogs = vi.fn<CanonicalExporter>(({ records }) => {
			expect(source.acknowledgements).toHaveLength(0);
			if (records[0]?.message === "second" && !failed) {
				failed = true;
				return errAsync(Object.assign(new Error("retry"), { retryable: true, retryAfterMs: 0 }));
			}
			return okAsync({ rejectedRecords: 0 });
		});
		const { instance } = await setupFileRuntime(source, [fileDestination("groups", exportLogs)]);
		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(
			exportLogs.mock.calls.map(([{ records }]) => records.map((entry) => entry.message)),
		).toEqual([["first"], ["second"], ["second"], ["third"]]);
		expect(exportLogs.mock.calls.map(([batch]) => batch.resourceAttributes)).toEqual([
			oldResource,
			newResource,
			newResource,
			oldResource,
		]);
		await instance.disconnect?.({ type: "manual" });
	});

	it("parks after retry exhaustion without acknowledging or counting durable records as dropped", async () => {
		const source = new FakeLogSource([record("retained")]);
		const exportLogs = vi.fn<CanonicalExporter>(() =>
			errAsync(Object.assign(new Error("retry"), { retryable: true, retryAfterMs: 0 })),
		);
		const { instance, state } = await setupFileRuntime(source, [
			fileDestination("exhausted", exportLogs),
		]);
		await vi.waitFor(() =>
			expect(state.destinations?.exhausted?.logs?.sourceStatus).toBe("parked"),
		);
		expect(exportLogs).toHaveBeenCalledTimes(2);
		expect(source.acknowledgements).toHaveLength(0);
		expect(state.destinations?.exhausted?.logs?.totalDropped).toBe(0);
		await instance.executeCommand?.({ type: "observability.flush" });
		expect(exportLogs).toHaveBeenCalledTimes(2);
		await instance.disconnect?.({ type: "manual" });
	});

	it("parks a failed checkpoint without re-exporting an already accepted batch", async () => {
		const source = new FakeLogSource([record("accepted")]);
		source.beforeAck = () => errAsync(new Error("disk full"));
		const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, state } = await setupFileRuntime(source, [
			fileDestination("checkpoint", exportLogs),
		]);
		await vi.waitFor(() =>
			expect(state.destinations?.checkpoint?.logs?.sourceStatus).toBe("parked"),
		);
		expect(source.acknowledgements).toHaveLength(0);
		expect(state.destinations?.checkpoint?.logs?.lastError).toContain("checkpoint");
		await instance.executeCommand?.({ type: "observability.flush" });
		expect(exportLogs).toHaveBeenCalledOnce();
		await instance.disconnect?.({ type: "manual" });
	});

	it("bounds shutdown during Retry-After and retains the unacknowledged receipt", async () => {
		vi.useFakeTimers();
		const source = new FakeLogSource([record("pending-retry")]);
		const exportLogs = vi.fn<CanonicalExporter>(() =>
			errAsync(Object.assign(new Error("busy"), { retryable: true, retryAfterMs: 45_000 })),
		);
		const { instance } = await setupFileRuntime(source, [fileDestination("shutdown", exportLogs)]);
		await vi.advanceTimersByTimeAsync(0);
		const disconnected = instance.disconnect?.({ type: "manual" });
		await vi.advanceTimersByTimeAsync(100);
		await disconnected;
		expect(exportLogs).toHaveBeenCalledOnce();
		expect(source.acknowledgements).toHaveLength(0);
		expect(source.closedReaders).toHaveLength(1);
	});

	it("ignores late timeout success after bounded shutdown without acknowledging or retrying", async () => {
		vi.useFakeTimers();
		const source = new FakeLogSource([record("late-success")]);
		let settle = () => {};
		const pending = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const exportLogs = vi.fn<CanonicalExporter>(() =>
			ResultAsync.fromPromise(pending, () => new Error("unexpected")).map(() => ({
				rejectedRecords: 0,
			})),
		);
		const { instance } = await setupFileRuntime(source, [fileDestination("late", exportLogs)], {
			deliveryTimeoutMs: 10,
		});
		await vi.advanceTimersByTimeAsync(10);
		expect(exportLogs.mock.calls[0]?.[1].signal.aborted).toBe(true);
		const disconnected = instance.disconnect?.({ type: "manual" });
		await vi.advanceTimersByTimeAsync(100);
		await disconnected;
		expect(source.acknowledgements).toHaveLength(0);
		settle();
		await vi.advanceTimersByTimeAsync(0);
		expect(exportLogs).toHaveBeenCalledOnce();
		expect(source.acknowledgements).toHaveLength(0);
		expect(source.closedReaders).toHaveLength(1);
	});

	it.each([
		{ label: "default", logStorage: undefined },
		{ label: "explicit file", logStorage: { type: "file" } },
	] as const)(
		"$label requires both replay capabilities for custom log exporters",
		async ({ logStorage }) => {
			for (const capabilities of [
				{},
				{ checkpointKey: "custom-route" },
				{ exportCanonical: () => okAsync({ rejectedRecords: 0 }) },
				{ exportCanonical: () => okAsync({ rejectedRecords: 0 }), checkpointKey: " " },
			] as const) {
				const { context } = createContext(new FakeLogSource());
				const exportLogs = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
				const shutdown = vi.fn(() => okAsync(undefined));
				const invalid = await observability({
					...(logStorage === undefined ? {} : { logStorage }),
					destinations: [
						{
							name: "custom",
							...("checkpointKey" in capabilities
								? { checkpointKey: capabilities.checkpointKey }
								: {}),
							create: () =>
								ok({
									logs: {
										...("exportCanonical" in capabilities
											? { exportCanonical: capabilities.exportCanonical }
											: {}),
										export: exportLogs,
									},
									shutdown,
								}),
						},
					],
				}).setup(context);
				expect(invalid.isErr()).toBe(true);
				if (invalid.isErr())
					expect(invalid.error.message).toContain("requires exportCanonical and checkpointKey");
				expect(exportLogs).not.toHaveBeenCalled();
				expect(context.eventBus.onAny).not.toHaveBeenCalled();
				expect(shutdown).toHaveBeenCalledOnce();
			}
		},
	);

	it.each([
		{ label: "default", logStorage: undefined },
		{ label: "explicit file", logStorage: { type: "file" } },
	] as const)(
		"$label allows metrics-only destinations without a source or replay capabilities",
		async ({ logStorage }) => {
			const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
			const { instance, context, state } = await setupFileRuntime(
				undefined,
				[
					{
						name: "metrics",
						create: () => ok({ metrics: { export: exportMetrics } }),
					},
				],
				{ logStorage },
			);
			await instance.ready?.();
			await instance.executeCommand?.({ type: "observability.flush" });
			expect(exportMetrics).toHaveBeenCalledOnce();
			expect(state.destinations?.metrics?.logs).toBeUndefined();
			expect(context.logger.warn).not.toHaveBeenCalled();
			await instance.disconnect?.({ type: "manual" });
		},
	);

	it("explicit memory captures only live events even when a canonical source is available", async () => {
		const source = new FakeLogSource([record("stored-only")]);
		const configureResource = vi.spyOn(source, "configureResourceAttributes");
		const exportLogs = vi.fn<LogExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, context, state } = await setupFileRuntime(
			source,
			[
				{
					name: "memory",
					create: () => ok({ logs: { export: exportLogs } }),
				},
			],
			{ logStorage: { type: "memory" } },
		);
		context.eventBus.emit("log:info", { message: "live-only", args: [], module: "app" });
		await instance.executeCommand?.({ type: "observability.flush" });
		expect(exportLogs).toHaveBeenCalledOnce();
		expect(exportLogs.mock.calls[0]?.[0].map((entry) => entry.message)).toEqual(["live-only"]);

		expect(state.destinations?.memory?.logs?.sourceStatus).toBeUndefined();
		expect(source.readers).toHaveLength(0);
		expect(source.acknowledgements).toHaveLength(0);
		expect(configureResource).not.toHaveBeenCalled();
		await instance.disconnect?.({ type: "manual" });
	});

	it("keeps a checkpoint stable across restart and exporter credential changes", async () => {
		const firstSource = new FakeLogSource();
		const first = await setupFileRuntime(firstSource, [
			fileDestination("account", () => okAsync({ rejectedRecords: 0 }), {
				checkpointKey: "logs-route",
			}),
		]);
		await vi.waitFor(() => expect(firstSource.readers).toHaveLength(1));
		await first.instance.disconnect?.({ type: "manual" });

		const secondSource = new FakeLogSource();
		const second = await setupFileRuntime(secondSource, [
			fileDestination("account", () => okAsync({ rejectedRecords: 0 }), {
				checkpointKey: "logs-route",
			}),
		]);
		await vi.waitFor(() => expect(secondSource.readers).toHaveLength(1));
		expect(secondSource.readers[0]).toBe(firstSource.readers[0]);
		await second.instance.disconnect?.({ type: "manual" });
	});

	it.each([
		{ label: "default", logStorage: undefined },
		{ label: "explicit file", logStorage: { type: "file" } },
	] as const)(
		"$label replays oldest retained canonical records with historical resources, not live events",
		async ({ logStorage }) => {
			const source = new FakeLogSource([record("stored")]);
			const destinationContexts: DestinationContext[] = [];
			const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
			const configured = fileDestination("archive", exportLogs);
			const destination: ObservabilityDestination = {
				...configured,
				create: (context) => {
					destinationContexts.push(context);
					return configured.create(context);
				},
			};
			const { instance, context } = await setupFileRuntime(source, [destination], { logStorage });

			await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
			expect(destinationContexts[0]?.resourceAttributes["service.instance.id"]).toBe("runtime-123");
			expect(source.resourceAttributes["service.instance.id"]).toBe("runtime-123");
			expect(exportLogs.mock.calls[0]?.[0].records.map((entry) => entry.message)).toEqual([
				"stored",
			]);
			expect(exportLogs.mock.calls[0]?.[0].records[0]?.timestamp).toEqual(
				new Date("2025-01-01T00:00:00.000Z"),
			);

			expect(exportLogs.mock.calls[0]?.[0].resourceAttributes).toEqual({
				"service.name": "historical",
				"service.instance.id": "old",
			});

			context.eventBus.emit("log:info", { message: "live-only", args: [], module: "app" });
			await instance.executeCommand?.({ type: "observability.flush" });
			expect(exportLogs).toHaveBeenCalledTimes(1);
			await instance.disconnect?.({ type: "manual" });
		},
	);

	it("does not advance the source receipt on retryable failure and acknowledges after retry succeeds", async () => {
		const source = new FakeLogSource([record("retry")]);
		let attempts = 0;
		const exportLogs = vi.fn<CanonicalExporter>(() => {
			attempts += 1;
			return attempts === 1
				? errAsync(Object.assign(new Error("temporary"), { retryable: true, retryAfterMs: 0 }))
				: okAsync({ rejectedRecords: 0 });
		});
		const { instance } = await setupFileRuntime(source, [fileDestination("retry", exportLogs)]);

		await vi.waitFor(() => expect(exportLogs).toHaveBeenCalledTimes(2));
		expect(source.acknowledgements).toHaveLength(1);
		await instance.disconnect?.({ type: "manual" });
	});

	it("parks permanent failures without acknowledging or blocking another destination", async () => {
		const source = new FakeLogSource([record("shared")]);
		const failing = vi.fn<CanonicalExporter>(() =>
			errAsync(Object.assign(new Error("invalid route"), { retryable: false })),
		);
		const successful = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, state } = await setupFileRuntime(source, [
			fileDestination("blocked", failing),
			fileDestination("healthy", successful),
		]);

		await vi.waitFor(() => expect(state.destinations?.blocked?.logs?.sourceStatus).toBe("parked"));
		await vi.waitFor(() => expect(successful).toHaveBeenCalledOnce());
		const blockedCheckpoint = source.readers[0];
		const healthyCheckpoint = source.readers[1];
		expect(blockedCheckpoint).not.toBe(healthyCheckpoint);
		expect(source.acknowledgements.map((ack) => ack.checkpointId)).toEqual([healthyCheckpoint]);
		await instance.disconnect?.({ type: "manual" });
	});

	it("acknowledges partial rejection once and counts rejected records as terminal", async () => {
		const source = new FakeLogSource([record("accepted"), record("rejected")]);
		const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 1 }));
		const { instance, state, snapshots } = await setupFileRuntime(source, [
			fileDestination("partial", exportLogs),
		]);

		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(state.destinations?.partial?.logs).toMatchObject({
			totalPushed: 1,
			totalDropped: 1,
			status: "degraded",
		});
		for (const snapshot of snapshots) {
			const logs = snapshot.destinations?.partial?.logs;
			if (!logs || (logs.totalPushed === 0 && logs.totalDropped === 0)) continue;
			expect(logs).toMatchObject({
				totalPushed: 1,
				totalDropped: 1,
				status: "degraded",
				queueSize: 0,
			});
		}
		expect(exportLogs).toHaveBeenCalledOnce();
		await instance.disconnect?.({ type: "manual" });
	});

	it("terminally acknowledges filtered records without exporting them", async () => {
		const source = new FakeLogSource([record("filtered", undefined, "command:success")]);
		const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
		const { instance, state } = await setupFileRuntime(
			source,
			[fileDestination("filtered", exportLogs)],
			{
				include: ["log:*"],
			},
		);

		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(exportLogs).not.toHaveBeenCalled();
		expect(state.destinations?.filtered?.logs?.totalDropped).toBe(0);
		await instance.disconnect?.({ type: "manual" });
	});

	it("reports known and unknown source gaps separately", async () => {
		const source = new FakeLogSource([record("after-gap")]);
		source.gaps = [
			{ reason: "retention", lostRecords: 4, detail: "retained oldest segment" },
			{ reason: "corruption", lostRecords: null, detail: "invalid line" },
		];
		const { instance, state } = await setupFileRuntime(source, [
			fileDestination("gaps", () => okAsync({ rejectedRecords: 0 })),
		]);

		await vi.waitFor(() => expect(source.acknowledgements).toHaveLength(1));
		expect(state.destinations?.gaps?.logs).toMatchObject({
			totalSourceRecordsLost: 4,
			totalUnknownSourceGaps: 1,
		});
		await instance.disconnect?.({ type: "manual" });
	});

	it.each([
		{ label: "default", logStorage: undefined },
		{ label: "explicit file", logStorage: { type: "file" } },
	] as const)(
		"$label keeps logs unavailable without a source while metrics continue, without fallback",
		async ({ logStorage }) => {
			const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
			const exportMetrics = vi.fn<MetricExporter["export"]>(() => okAsync({ rejectedRecords: 0 }));
			const { instance, context, state } = await setupFileRuntime(
				undefined,
				[fileDestination("offline", exportLogs, { metrics: { export: exportMetrics } })],
				{ logStorage },
			);

			context.eventBus.emit("log:info", { message: "must-not-fallback", args: [], module: "app" });
			await instance.ready?.();
			await instance.executeCommand?.({ type: "observability.flush" });
			expect(exportLogs).not.toHaveBeenCalled();
			expect(exportMetrics).toHaveBeenCalledOnce();
			expect(state.destinations?.offline?.logs?.sourceStatus).toBe("unavailable");
			await instance.disconnect?.({ type: "manual" });
		},
	);

	it("captures a finite barrier before draining a flush", async () => {
		const source = new FakeLogSource([record("before-barrier")]);
		source.holdUnboundedReads = true;
		source.onFlush = () => source.append(record("after-barrier"));
		const exportLogs = vi.fn<CanonicalExporter>(() => okAsync({ rejectedRecords: 0 }));
		const { instance } = await setupFileRuntime(source, [fileDestination("finite", exportLogs)]);

		await instance.executeCommand?.({ type: "observability.flush" });
		expect(
			exportLogs.mock.calls.flatMap((call) => call[0].records.map((entry) => entry.message)),
		).toEqual(["before-barrier"]);
		await instance.disconnect?.({ type: "manual" });
	});

	it("quarantines an exporter that ignores timeout without overlapping another call", async () => {
		const source = new FakeLogSource([record("blocked")]);
		const never = new Promise<never>(() => {});
		const actualExport = vi.fn<CanonicalExporter>(() =>
			ResultAsync.fromPromise(never, () => new Error("unreachable")),
		);
		const { instance, state } = await setupFileRuntime(
			source,
			[fileDestination("timeout", actualExport)],
			{ deliveryTimeoutMs: 10 },
		);

		await vi.waitFor(() =>
			expect(state.destinations?.timeout?.logs?.lastError).toContain("timed out"),
		);
		expect(actualExport).toHaveBeenCalledOnce();
		expect(source.acknowledgements).toHaveLength(0);
		const disconnect = instance.disconnect?.({ type: "manual" });
		await expect(disconnect).resolves.toBeDefined();
		expect(actualExport).toHaveBeenCalledOnce();
	});
});
