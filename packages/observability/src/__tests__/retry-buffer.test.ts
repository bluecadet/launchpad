import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../core/log-entry.js";
import { RetryBuffer } from "../core/retry-buffer.js";

function makeEntries(count = 1): LogEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		timestamp: new Date(),
		level: "info" as const,
		message: `message-${i}`,
		event: "log:info",
		metadata: {},
	}));
}

describe("RetryBuffer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("enqueue", () => {
		it("adds a batch and returns null when under capacity", () => {
			const buffer = new RetryBuffer({ maxBatches: 3, maxRetries: 3 });
			const dropped = buffer.enqueue(makeEntries(2));

			expect(dropped).toBeNull();
			expect(buffer.size).toBe(1);
		});

		it("accepts multiple batches up to maxBatches without dropping", () => {
			const buffer = new RetryBuffer({ maxBatches: 3, maxRetries: 3 });

			buffer.enqueue(makeEntries(1));
			buffer.enqueue(makeEntries(1));
			const dropped = buffer.enqueue(makeEntries(1));

			expect(dropped).toBeNull();
			expect(buffer.size).toBe(3);
		});

		it("drops the oldest batch and returns it when at capacity", () => {
			const buffer = new RetryBuffer({ maxBatches: 2, maxRetries: 3 });

			const first = makeEntries(2);
			const second = makeEntries(3);
			const third = makeEntries(1);

			buffer.enqueue(first);
			buffer.enqueue(second);
			const dropped = buffer.enqueue(third);

			expect(dropped).not.toBeNull();
			expect(dropped!.reason).toBe("buffer-full");
			expect(dropped!.entries).toBe(first);
			expect(buffer.size).toBe(2);
		});
	});

	describe("dequeueReady", () => {
		it("returns empty array when nothing is past its retry time", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });
			buffer.enqueue(makeEntries(1));

			const ready = buffer.dequeueReady();

			expect(ready).toHaveLength(0);
			expect(buffer.size).toBe(1);
		});

		it("returns ready batches after advancing time past nextRetryAt", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });
			buffer.enqueue(makeEntries(1));

			vi.advanceTimersByTime(1001);

			const ready = buffer.dequeueReady();

			expect(ready).toHaveLength(1);
			expect(buffer.size).toBe(0);
		});

		it("only returns batches whose time has passed, leaving others in buffer", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });

			buffer.enqueue(makeEntries(1));

			vi.advanceTimersByTime(1001);

			buffer.enqueue(makeEntries(1));

			const ready = buffer.dequeueReady();

			expect(ready).toHaveLength(1);
			expect(buffer.size).toBe(1);
		});
	});

	describe("requeue", () => {
		it("re-enqueues a batch with decremented retries and backoff", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });
			buffer.enqueue(makeEntries(1));

			vi.advanceTimersByTime(1001);

			const [pending] = buffer.dequeueReady();
			expect(pending).toBeDefined();

			const dropped = buffer.requeue(pending!);

			expect(dropped).toBeNull();
			expect(buffer.size).toBe(1);
		});

		it("returns batch with reason max-retries when retriesLeft reaches 0", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 1 });
			const entries = makeEntries(2);
			buffer.enqueue(entries);

			vi.advanceTimersByTime(1001);

			const [pending] = buffer.dequeueReady();
			expect(pending).toBeDefined();
			expect(pending!.retriesLeft).toBe(1);

			// First requeue decrements to 0
			const firstRequeue = buffer.requeue(pending!);
			expect(firstRequeue).toBeNull();

			vi.advanceTimersByTime(10_000);
			const [secondPending] = buffer.dequeueReady();
			expect(secondPending!.retriesLeft).toBe(0);

			const dropped = buffer.requeue(secondPending!);
			expect(dropped).not.toBeNull();
			expect(dropped!.reason).toBe("max-retries");
			expect(dropped!.entries).toBe(entries);
		});

		it("applies exponential backoff on requeue", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });
			buffer.enqueue(makeEntries(1));

			vi.advanceTimersByTime(1001);

			const [pending] = buffer.dequeueReady();
			expect(pending!.retriesLeft).toBe(3);

			buffer.requeue(pending!);

			// After requeue, should not be ready immediately
			const notReady = buffer.dequeueReady();
			expect(notReady).toHaveLength(0);

			// Advance past the 2^1 * 1000 = 2000ms backoff for attempt 1
			vi.advanceTimersByTime(2001);
			const ready = buffer.dequeueReady();
			expect(ready).toHaveLength(1);
			expect(ready[0]!.retriesLeft).toBe(2);
		});

		it("drops oldest batch when buffer is full during requeue", () => {
			const buffer = new RetryBuffer({ maxBatches: 2, maxRetries: 3 });

			const firstEntries = makeEntries(1);

			// Enqueue first batch and make it ready
			buffer.enqueue(firstEntries);
			vi.advanceTimersByTime(1001);

			const [firstPending] = buffer.dequeueReady();
			expect(buffer.size).toBe(0);

			// Fill the buffer to capacity with two new batches
			buffer.enqueue(makeEntries(1));
			buffer.enqueue(makeEntries(1));
			expect(buffer.size).toBe(2);

			// Requeue the first pending batch — buffer is full so oldest is dropped
			const dropped = buffer.requeue(firstPending!);
			expect(dropped).not.toBeNull();
			expect(dropped!.reason).toBe("buffer-full");
		});
	});

	describe("size", () => {
		it("reflects current buffer length", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });

			expect(buffer.size).toBe(0);

			buffer.enqueue(makeEntries(1));
			expect(buffer.size).toBe(1);

			buffer.enqueue(makeEntries(1));
			expect(buffer.size).toBe(2);

			vi.advanceTimersByTime(1001);
			buffer.dequeueReady();
			expect(buffer.size).toBe(0);
		});
	});

	describe("drain", () => {
		it("clears the buffer and returns all entries", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });

			const a = makeEntries(2);
			const b = makeEntries(3);
			buffer.enqueue(a);
			buffer.enqueue(b);

			const all = buffer.drain();

			expect(all).toHaveLength(2);
			expect(all[0]).toBe(a);
			expect(all[1]).toBe(b);
			expect(buffer.size).toBe(0);
		});

		it("returns empty array when buffer is empty", () => {
			const buffer = new RetryBuffer({ maxBatches: 5, maxRetries: 3 });

			const all = buffer.drain();

			expect(all).toHaveLength(0);
		});
	});
});
