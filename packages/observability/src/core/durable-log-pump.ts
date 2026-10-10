import { createHash } from "node:crypto";
import type {
	LoggerSource,
	LoggerSourceReader,
	LogSourceBarrier,
	NormalizedLogRecord,
	ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import type { DestinationTransition } from "../observability-state.js";
import type { CanonicalLogBatch, ExportFailure, ExportResult, LogExporter } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";
import {
	type AttemptOutcome,
	retryDelay,
	startAttempt,
	validExportResult,
} from "./exporter-attempt.js";

const CHECKPOINT_VERSION = 1;
const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_READ_MAX_BYTES = 1_048_576;
const MIN_IDLE_READ_INTERVAL_MS = 100;
const MAX_IDLE_READ_INTERVAL_MS = 30_000;

type Deferred = {
	readonly promise: Promise<void>;
	resolve: () => void;
};

type BarrierRequest = {
	readonly barrier: LogSourceBarrier;
	readonly completion: Deferred;
};

export interface DurableLogPumpOptions {
	readonly source: LoggerSource;
	readonly checkpointId: string;
	readonly destinationName: string;
	readonly exporter: NonNullable<LogExporter["exportCanonical"]>;
	readonly maxEntries: number;
	readonly maxRetries: number;
	readonly deliveryTimeoutMs: number;
	readonly idleWaitMs: number;
	readonly includeRecord: (record: NormalizedLogRecord) => boolean;
	readonly onTransition: (transition: DestinationTransition) => void;
}

function createDeferred(): Deferred {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function resourceAttributesEqual(left: ResourceAttributes, right: ResourceAttributes): boolean {
	if (left === right) return true;
	const leftEntries = Object.entries(left);
	const rightEntries = Object.entries(right);
	if (leftEntries.length !== rightEntries.length) return false;
	return leftEntries.every(([key, value]) => right[key] === value);
}

function contiguousResourceGroups(
	records: readonly NormalizedLogRecord[],
): readonly CanonicalLogBatch[] {
	const groups: Array<{ records: NormalizedLogRecord[]; resourceAttributes: ResourceAttributes }> =
		[];
	for (const record of records) {
		const current = groups.at(-1);
		if (current && resourceAttributesEqual(current.resourceAttributes, record.resource)) {
			current.records.push(record);
			continue;
		}
		groups.push({ records: [record], resourceAttributes: record.resource });
	}
	return groups;
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
	let remainingMs = milliseconds;
	while (remainingMs > 0 && !signal.aborted) {
		const intervalMs = Math.min(remainingMs, MAX_TIMER_MS);
		await delayInterval(intervalMs, signal);
		remainingMs -= intervalMs;
	}
}

function delayInterval(milliseconds: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(finish, milliseconds);
		timer.unref?.();
		function finish() {
			signal.removeEventListener("abort", finish);
			clearTimeout(timer);
			resolve();
		}
		signal.addEventListener("abort", finish, { once: true });
	});
}

/** Build a credential-free durable cursor identity for one logical target route. */
export function createLogCheckpointId(
	sourceId: string,
	destinationName: string,
	checkpointKey: string,
): string {
	const identity = JSON.stringify([
		"launchpad-observability-log-checkpoint",
		CHECKPOINT_VERSION,
		sourceId,
		destinationName,
		checkpointKey,
	]);
	return `observability-v${CHECKPOINT_VERSION}-${createHash("sha256").update(identity).digest("hex")}`;
}

/**
 * Delivers one controller-owned canonical log independently to one destination.
 * The source owns every cursor write; this pump only decides when a receipt is
 * safe to acknowledge.
 */
export class DurableLogPump {
	private reader: LoggerSourceReader | null = null;
	private readonly lifecycleController = new AbortController();
	private readController: AbortController | null = null;
	private deliveryController: AbortController | null = null;
	private idleController: AbortController | null = null;
	private readonly barrierRequests: BarrierRequest[] = [];
	private workPromise: Promise<void> | null = null;
	private closePromise: Promise<void> | null = null;
	private stopAfterBarrier = false;
	private forceStopped = false;
	private parked = false;
	private paused = false;
	private pauseCompletion: Deferred | null = null;

	constructor(private readonly options: DurableLogPumpOptions) {}

	start(): void {
		if (this.workPromise) return;
		this.workPromise = this.run()
			.catch(() => {
				this.park("Canonical log pump failed", "unavailable");
			})
			.finally(() => {
				this.closePromise = this.closeReader();
			});
	}

	/** Pause before capturing a barrier so no new unconstrained read can pass it. */
	pause(): void {
		if (this.forceStopped || this.parked || this.paused) return;
		this.paused = true;
		this.pauseCompletion = createDeferred();
		this.readController?.abort();
		this.idleController?.abort();
	}

	resume(): void {
		if (!this.paused) return;
		this.paused = false;
		this.pauseCompletion?.resolve();
		this.pauseCompletion = null;
	}

	/** Drain only through the supplied source barrier, bounded by the caller. */
	async flush(through: LogSourceBarrier, timeoutMs: number): Promise<void> {
		if (this.parked || this.forceStopped) return;
		if (!this.workPromise) this.start();
		const request = this.requestBarrier(through);
		await this.waitBounded(request.completion.promise, timeoutMs);
	}

	/** Stop new unconstrained reads and close after pending receipt work settles. */
	async shutdown(through: LogSourceBarrier | null, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + Math.max(0, timeoutMs);
		this.stopAfterBarrier = true;
		let barrierPromise: Promise<void> = Promise.resolve();
		if (through === null || this.parked || !this.workPromise) {
			this.forceStop();
		} else {
			barrierPromise = this.requestBarrier(through).completion.promise;
		}

		await this.waitBounded(barrierPromise, Math.max(0, deadline - Date.now()));
		if (through !== null && this.barrierRequests.length > 0) this.forceStop();
		await this.waitBounded(
			this.workPromise ?? Promise.resolve(),
			Math.max(0, deadline - Date.now()),
		);
		await this.waitBounded(
			this.closePromise ?? Promise.resolve(),
			Math.max(0, deadline - Date.now()),
		);
		if (this.workPromise) {
			void this.workPromise.then(() => this.closePromise).catch(() => undefined);
		}
	}

	private requestBarrier(barrier: LogSourceBarrier): BarrierRequest {
		this.resume();
		const completion = createDeferred();
		const request = { barrier, completion };
		this.barrierRequests.push(request);
		// A blocked unconstrained read or idle wait must restart with the finite boundary.
		this.readController?.abort();
		this.idleController?.abort();
		return request;
	}

	private async run(): Promise<void> {
		if (!this.options.source.status.available) {
			this.park("Canonical log source is unavailable", "unavailable");
			return;
		}

		const opened = await this.options.source.createReader(
			{ checkpointId: this.options.checkpointId },
			this.lifecycleController.signal,
		);
		if (opened.isErr()) {
			this.park("Canonical log reader could not be opened", "unavailable");
			return;
		}
		this.reader = opened.value;
		this.options.onTransition({ type: "source", status: "active", queuedBatches: 0 });
		while (!this.forceStopped && !this.parked) {
			const shouldContinue = await this.readAndDeliver();
			if (!shouldContinue) return;
		}
	}

	private async readAndDeliver(): Promise<boolean> {
		const reader = this.reader;
		if (!reader) return false;
		if (this.paused && this.pauseCompletion) await this.pauseCompletion.promise;
		if (this.forceStopped) return false;
		const requestedBarrier = this.barrierRequests[0]?.barrier;
		const readController = new AbortController();
		this.readController = readController;

		const read = await reader.read({
			maxEntries: this.options.maxEntries,
			maxBytes: DEFAULT_READ_MAX_BYTES,
			...(requestedBarrier === undefined ? {} : { through: requestedBarrier }),
			signal: readController.signal,
		});
		if (this.readController === readController) this.readController = null;
		if (read.isErr()) {
			if (readController.signal.aborted && !this.forceStopped) return true;
			if (this.forceStopped) return false;
			this.park(
				"Canonical log read failed",
				this.options.source.status.available ? "parked" : "unavailable",
			);
			return false;
		}
		const batch = read.value;
		const records = batch.records.filter(this.options.includeRecord);
		this.options.onTransition({
			type: "source-batch",
			queuedBatches: records.length > 0 ? 1 : 0,
			lostRecords: batch.gaps.reduce((count, gap) => count + (gap.lostRecords ?? 0), 0),
			unknownGaps: batch.gaps.filter((gap) => gap.lostRecords === null).length,
		});
		const delivered = await this.deliverGroups(contiguousResourceGroups(records));
		if (!delivered || this.forceStopped || this.parked) return false;

		// Even an empty batch owns a receipt and may cross a segment header or
		// source gap. Release it; the source elides unchanged-cursor disk writes.
		const acknowledged = await reader.ack(batch.receipt, this.lifecycleController.signal);
		if (acknowledged.isErr()) {
			this.park("Canonical log checkpoint could not be saved", "parked");
			return false;
		}
		this.options.onTransition({ type: "source", status: "active", queuedBatches: 0 });

		if (requestedBarrier !== undefined && batch.reachedThrough) {
			const completed = this.barrierRequests.shift();
			completed?.completion.resolve();
			if (this.stopAfterBarrier && this.barrierRequests.length === 0) return false;
		}
		if (
			batch.records.length === 0 &&
			!batch.reachedThrough &&
			this.barrierRequests.length === 0 &&
			!this.paused &&
			!this.forceStopped
		) {
			const idleController = new AbortController();
			this.idleController = idleController;
			await delay(
				Math.min(
					Math.max(this.options.idleWaitMs, MIN_IDLE_READ_INTERVAL_MS),
					MAX_IDLE_READ_INTERVAL_MS,
				),
				idleController.signal,
			);
			if (this.idleController === idleController) this.idleController = null;
		}
		return !this.forceStopped;
	}

	private async deliverGroups(groups: readonly CanonicalLogBatch[]): Promise<boolean> {
		for (const [index, group] of groups.entries()) {
			let attempt = 0;
			while (!this.forceStopped) {
				const outcome = await this.attemptDelivery(group);
				if (outcome === null) return false;
				const result = outcome.result;
				if (result.isOk()) {
					if (!validExportResult(result.value, group.records.length)) {
						this.park("Destination exporter returned an invalid acknowledgement", "parked");
						return false;
					}
					const rejected = result.value.rejectedRecords;
					const accepted = group.records.length - rejected;
					this.options.onTransition({
						type: "export",
						queuedBatches: index === groups.length - 1 ? 0 : 1,
						acceptedRecords: accepted,
						rejectedRecords: rejected,
					});
					break;
				}

				if (result.error.retryable === false) {
					this.park(result.error, "parked");
					return false;
				}
				if (attempt >= this.options.maxRetries) {
					this.park("Destination log delivery retries exhausted", "parked");
					return false;
				}
				if (outcome.source !== "timeout") {
					this.options.onTransition({
						type: "failure",
						error: result.error,
						queuedBatches: 1,
						droppedRecords: 0,
					});
				}
				await delay(
					retryDelay(attempt, result.error.retryAfterMs, Number.POSITIVE_INFINITY),
					this.lifecycleController.signal,
				);
				attempt += 1;
			}
		}
		return !this.forceStopped;
	}

	private async attemptDelivery(
		group: CanonicalLogBatch,
	): Promise<AttemptOutcome<ExportResult> | null> {
		const controller = new AbortController();
		this.deliveryController = controller;
		const attempt = startAttempt({
			call: (signal) => this.options.exporter(group, { signal }),
			controller,
			timeoutMs: this.options.deliveryTimeoutMs,
			timeoutMessage: `Destination delivery timed out after ${this.options.deliveryTimeoutMs}ms`,
		});
		const outcome = await attempt.outcome;
		if (outcome.source === "timeout" && outcome.result.isErr()) {
			this.options.onTransition({
				type: "failure",
				error: outcome.result.error,
				queuedBatches: 1,
				droppedRecords: 0,
			});
		}
		await attempt.settled;
		if (this.deliveryController === controller) this.deliveryController = null;
		return this.forceStopped ? null : outcome;
	}

	private park(error: string | ExportFailure, status: "unavailable" | "parked"): void {
		this.parked = true;
		this.options.onTransition({
			type: "source",
			status,
			error: typeof error === "string" ? new DestinationFailure(error) : error,
			queuedBatches: 0,
		});
	}

	private forceStop(): void {
		if (this.forceStopped) return;
		this.forceStopped = true;
		this.resume();
		this.lifecycleController.abort();
		this.readController?.abort();
		this.deliveryController?.abort();
		this.idleController?.abort();
		for (const request of this.barrierRequests.splice(0)) request.completion.resolve();
	}

	private async closeReader(): Promise<void> {
		const reader = this.reader;
		if (!reader) return;
		const controller = new AbortController();
		const closed = await reader.close(controller.signal);
		if (closed.isErr()) {
			this.park("Canonical log reader could not be closed", "unavailable");
		}
	}

	private async waitBounded(operation: Promise<void>, timeoutMs: number): Promise<void> {
		if (timeoutMs <= 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			operation.catch(() => undefined),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
				timer.unref?.();
			}),
		]);
		if (timer) clearTimeout(timer);
	}
}
