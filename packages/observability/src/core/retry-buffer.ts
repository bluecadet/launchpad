import type { LogEntry } from "./log-entry.js";

export type RetryBufferConfig = {
	maxBatches: number;
	maxRetries: number;
};

type PendingBatch = {
	entries: LogEntry[];
	retriesLeft: number;
	nextRetryAt: number;
};

export type DroppedBatch = {
	entries: LogEntry[];
	reason: "buffer-full" | "max-retries";
};

/**
 * Stores failed log batches and retries them with exponential backoff.
 * When the buffer exceeds maxBatches, the oldest batch is dropped.
 */
export class RetryBuffer {
	private batches: PendingBatch[] = [];

	constructor(private readonly config: RetryBufferConfig) {}

	/**
	 * Enqueues a failed batch for retry.
	 * Returns the dropped batch if the buffer was full, or null if there was room.
	 */
	enqueue(entries: LogEntry[]): DroppedBatch | null {
		let dropped: DroppedBatch | null = null;

		if (this.batches.length >= this.config.maxBatches) {
			const oldest = this.batches.shift();
			if (oldest) {
				dropped = { entries: oldest.entries, reason: "buffer-full" };
			}
		}

		const backoffMs = 1000; // initial 1s backoff on first retry
		this.batches.push({
			entries,
			retriesLeft: this.config.maxRetries,
			nextRetryAt: Date.now() + backoffMs,
		});

		return dropped;
	}

	/**
	 * Re-enqueues a batch after a retry failure.
	 * Returns the dropped batch if it has exhausted retries or the buffer was full.
	 */
	requeue(batch: PendingBatch): DroppedBatch | null {
		if (batch.retriesLeft <= 1) {
			return { entries: batch.entries, reason: "max-retries" };
		}

		let dropped: DroppedBatch | null = null;

		if (this.batches.length >= this.config.maxBatches) {
			const oldest = this.batches.shift();
			if (oldest) {
				dropped = { entries: oldest.entries, reason: "buffer-full" };
			}
		}

		const attemptNumber = this.config.maxRetries - batch.retriesLeft + 1;
		const backoffMs = Math.min(2 ** attemptNumber * 1000, 30_000);
		this.batches.push({
			entries: batch.entries,
			retriesLeft: batch.retriesLeft - 1,
			nextRetryAt: Date.now() + backoffMs,
		});

		return dropped;
	}

	/**
	 * Returns all batches whose next retry time has passed, removing them from the buffer.
	 */
	dequeueReady(): PendingBatch[] {
		const now = Date.now();
		const ready: PendingBatch[] = [];
		const remaining: PendingBatch[] = [];

		for (const batch of this.batches) {
			if (batch.nextRetryAt <= now) {
				ready.push(batch);
			} else {
				remaining.push(batch);
			}
		}

		this.batches = remaining;
		return ready;
	}

	get size(): number {
		return this.batches.length;
	}

	drain(): LogEntry[][] {
		const all = this.batches.map((b) => b.entries);
		this.batches = [];
		return all;
	}
}
