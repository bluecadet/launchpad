import { err, type Result, type ResultAsync } from "neverthrow";
import type { ExportFailure, ExportResult } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";

type DeliveryQueueMode = "retry" | "coalesce";
type DeliveryDropReason = "queue-full" | "shutdown";

/** One completed queue mutation, published after retry and eviction decisions. */
export type DeliveryTransition = { readonly queuedBatches: number } & (
	| { readonly type: "queue" }
	| { readonly type: "drop"; readonly droppedRecords: number; readonly reason: DeliveryDropReason }
	| { readonly type: "export"; readonly acceptedRecords: number; readonly rejectedRecords: number }
	| { readonly type: "failure"; readonly error: ExportFailure; readonly droppedRecords: number }
);

export interface DeliveryQueueOptions<T> {
	readonly mode: DeliveryQueueMode;
	readonly maxQueuedBatches: number;
	readonly maxRetries: number;
	readonly deliveryTimeoutMs: number;
	readonly countRecords: (batch: T) => number;
	readonly deliver: (batch: T, signal: AbortSignal) => ResultAsync<ExportResult, ExportFailure>;
	readonly onTransition?: (transition: DeliveryTransition) => void;
}

type PendingBatch<T> = {
	readonly batch: T;
	readonly completion: Deferred;
	readonly attempt: number;
	readonly readyAt: number;
};

type Deferred = {
	readonly promise: Promise<void>;
	resolve: () => void;
};

const MAX_RETRY_DELAY_MS = 30_000;

function createDeferred(): Deferred {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function toExportFailure(value: unknown, fallbackMessage: string): ExportFailure {
	if (value instanceof Error) return value;
	return new Error(fallbackMessage, { cause: value });
}

function timeoutFailure(timeoutMs: number): ExportFailure {
	return new DestinationFailure(`Destination delivery timed out after ${timeoutMs}ms`, {
		retryable: true,
	});
}

function hasValidRejectedRecords(
	result: ExportResult,
	totalRecords: number,
): result is ExportResult & { rejectedRecords: number } {
	return (
		Number.isInteger(result.rejectedRecords) &&
		result.rejectedRecords >= 0 &&
		result.rejectedRecords <= totalRecords
	);
}

/**
 * Serializes delivery for one destination signal. The queue is bounded by batch
 * count; it intentionally makes no claim about bounding retained bytes.
 */
export class DeliveryQueue<T> {
	private readonly pending: PendingBatch<T>[] = [];
	private readonly unsettled = new Set<Promise<void>>();
	private inFlight = false;
	private closed = false;
	private wakeTimer: ReturnType<typeof setTimeout> | null = null;
	private attemptController: AbortController | null = null;

	constructor(private readonly options: DeliveryQueueOptions<T>) {}

	enqueue(batch: T): boolean {
		if (this.closed) {
			this.options.onTransition?.({
				type: "drop",
				queuedBatches: this.pending.length,
				droppedRecords: this.options.countRecords(batch),
				reason: "shutdown",
			});
			return false;
		}

		const completion = createDeferred();
		this.unsettled.add(completion.promise);
		void completion.promise.finally(() => this.unsettled.delete(completion.promise));
		const pendingBatch: PendingBatch<T> = {
			batch,
			completion,
			attempt: 0,
			readyAt: Date.now(),
		};

		let droppedRecords = 0;
		if (this.options.mode === "coalesce" && this.pending.length > 0) {
			const replaced = this.pending.splice(0);
			for (const stale of replaced) stale.completion.resolve();
			this.pending.push(pendingBatch);
		} else {
			droppedRecords = this.evictOldestIfFull();
			this.pending.push(pendingBatch);
		}

		this.options.onTransition?.(
			droppedRecords > 0
				? { type: "drop", queuedBatches: this.pending.length, droppedRecords, reason: "queue-full" }
				: { type: "queue", queuedBatches: this.pending.length },
		);
		this.pump();
		return true;
	}

	/** Wait for work admitted before this call, bounded by the supplied deadline. */
	async flush(timeoutMs: number): Promise<void> {
		const admitted = [...this.unsettled];
		if (admitted.length === 0) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled(admitted).then(() => undefined),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
				timer.unref?.();
			}),
		]);
		if (timer) clearTimeout(timer);
	}

	/** Stop accepting work and abort the active attempt. */
	stop(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.wakeTimer) {
			clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		}
		this.attemptController?.abort();
		let droppedRecords = 0;
		for (const pending of this.pending.splice(0)) {
			droppedRecords += this.options.countRecords(pending.batch);
			pending.completion.resolve();
		}
		this.options.onTransition?.({
			type: "drop",
			queuedBatches: 0,
			droppedRecords,
			reason: "shutdown",
		});
	}

	get queuedBatches(): number {
		return this.pending.length;
	}

	private evictOldestIfFull(): number {
		if (this.pending.length < this.options.maxQueuedBatches) return 0;
		const dropped = this.pending.shift();
		if (!dropped) return 0;
		dropped.completion.resolve();
		return this.options.countRecords(dropped.batch);
	}

	private pump(): void {
		if (this.closed || this.inFlight || this.pending.length === 0) return;
		const next = this.pending[0];
		if (!next) return;

		const waitMs = next.readyAt - Date.now();
		if (waitMs > 0) {
			if (this.wakeTimer) clearTimeout(this.wakeTimer);
			this.wakeTimer = setTimeout(() => {
				this.wakeTimer = null;
				this.pump();
			}, waitMs);
			this.wakeTimer.unref?.();
			return;
		}

		this.pending.shift();
		this.options.onTransition?.({ type: "queue", queuedBatches: this.pending.length });
		this.inFlight = true;
		void this.attempt(next).then((result) => {
			this.inFlight = false;
			if (result) this.handleResult(next, result);
			this.pump();
		});
	}

	private async attempt(
		batch: PendingBatch<T>,
	): Promise<Result<ExportResult, ExportFailure> | null> {
		const controller = new AbortController();
		this.attemptController = controller;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let removeAbortListener = () => {};

		type AttemptOutcome =
			| { source: "delivery"; result: Result<ExportResult, ExportFailure> }
			| { source: "deadline"; result: Result<ExportResult, ExportFailure> };
		const deadline = new Promise<AttemptOutcome>((resolve) => {
			timeout = setTimeout(() => {
				resolve({
					source: "deadline",
					result: err(timeoutFailure(this.options.deliveryTimeoutMs)),
				});
				controller.abort();
			}, this.options.deliveryTimeoutMs);
			timeout.unref?.();
		});
		const stopped = new Promise<AttemptOutcome>((resolve) => {
			const onAbort = () =>
				resolve({
					source: "deadline",
					result: err(new DestinationFailure("Destination delivery aborted", { retryable: false })),
				});
			controller.signal.addEventListener("abort", onAbort, { once: true });
			removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
		});

		let delivery: Promise<Result<ExportResult, ExportFailure>>;
		try {
			delivery = Promise.resolve(this.options.deliver(batch.batch, controller.signal)).catch(
				(error: unknown) => err(toExportFailure(error, "Destination exporter rejected")),
			);
		} catch (error) {
			delivery = Promise.resolve(
				err(toExportFailure(error, "Destination exporter threw while starting delivery")),
			);
		}
		const delivered = delivery.then((result): AttemptOutcome => ({ source: "delivery", result }));
		const outcome = await Promise.race([delivered, deadline, stopped]);
		if (timeout) clearTimeout(timeout);

		if (outcome.source === "deadline") {
			// Account for the logical timeout immediately, but keep this signal's
			// physical slot occupied until an exporter that ignored AbortSignal
			// actually settles. Its late result is intentionally ignored so an old
			// gauge snapshot cannot overwrite a newer one.
			this.handleResult(batch, outcome.result);
			await delivery;
			removeAbortListener();
			if (this.attemptController === controller) this.attemptController = null;
			return null;
		}
		removeAbortListener();
		if (this.attemptController === controller) this.attemptController = null;
		return outcome.result;
	}

	private handleResult(
		pending: PendingBatch<T>,
		result: Result<ExportResult, ExportFailure>,
	): void {
		const records = this.options.countRecords(pending.batch);
		if (result.isOk()) {
			if (!hasValidRejectedRecords(result.value, records)) {
				this.options.onTransition?.({
					type: "failure",
					queuedBatches: this.pending.length,
					droppedRecords: records,
					error: new DestinationFailure(
						"Destination exporter returned an invalid rejectedRecords count",
						{ retryable: false },
					),
				});
				pending.completion.resolve();
				return;
			}
			const rejected = result.value.rejectedRecords;
			this.options.onTransition?.({
				type: "export",
				queuedBatches: this.pending.length,
				acceptedRecords: records - rejected,
				rejectedRecords: rejected,
			});
			pending.completion.resolve();
			return;
		}

		const shouldRetry =
			this.options.mode === "retry" &&
			result.error.retryable !== false &&
			pending.attempt < this.options.maxRetries &&
			!this.closed;
		let droppedRecords = records;
		if (shouldRetry) {
			droppedRecords = this.evictOldestIfFull();
			this.pending.unshift({
				...pending,
				attempt: pending.attempt + 1,
				readyAt: Date.now() + this.retryDelay(pending.attempt, result.error.retryAfterMs),
			});
		} else {
			pending.completion.resolve();
		}
		this.options.onTransition?.({
			type: "failure",
			queuedBatches: this.pending.length,
			error: result.error,
			droppedRecords,
		});
	}

	private retryDelay(attempt: number, retryAfterMs: number | undefined): number {
		const exponentialDelay = Math.min(2 ** attempt * 1_000, MAX_RETRY_DELAY_MS);
		if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs)) return exponentialDelay;
		return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_DELAY_MS);
	}
}
