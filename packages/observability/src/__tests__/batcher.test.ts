import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Batcher } from "../core/batcher.js";
import type { LogEntry } from "../core/log-entry.js";

function makeEntry(message = "test"): LogEntry {
	return {
		timestamp: new Date(),
		level: "info",
		message,
		event: "log:info",
		metadata: {},
	};
}

describe("Batcher", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("flush behavior", () => {
		it("does not flush when empty", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 1000, maxEntries: 10 }, onFlush);

			batcher.flush();

			expect(onFlush).not.toHaveBeenCalled();
		});

		it("flushes when maxEntries is reached", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 10_000, maxEntries: 3 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("1"));
			batcher.add(makeEntry("2"));
			expect(onFlush).not.toHaveBeenCalled();

			batcher.add(makeEntry("3"));
			expect(onFlush).toHaveBeenCalledOnce();
			expect(onFlush).toHaveBeenCalledWith([
				expect.objectContaining({ message: "1" }),
				expect.objectContaining({ message: "2" }),
				expect.objectContaining({ message: "3" }),
			]);
		});

		it("flushes on interval", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 1000, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("a"));
			batcher.add(makeEntry("b"));
			expect(onFlush).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);

			expect(onFlush).toHaveBeenCalledOnce();
			expect(onFlush).toHaveBeenCalledWith([
				expect.objectContaining({ message: "a" }),
				expect.objectContaining({ message: "b" }),
			]);
		});

		it("does not flush before interval when below threshold", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 1000, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry());
			vi.advanceTimersByTime(500);

			expect(onFlush).not.toHaveBeenCalled();
		});

		it("flush called manually delivers entries", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 10_000, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("manual"));
			batcher.flush();

			expect(onFlush).toHaveBeenCalledOnce();
			expect(onFlush).toHaveBeenCalledWith([expect.objectContaining({ message: "manual" })]);
		});
	});

	describe("stop", () => {
		it("flushes remaining entries on stop", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 10_000, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("remaining"));
			batcher.stop();

			expect(onFlush).toHaveBeenCalledOnce();
			expect(onFlush).toHaveBeenCalledWith([expect.objectContaining({ message: "remaining" })]);
		});

		it("does not flush on stop if empty", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 1000, maxEntries: 10 }, onFlush);
			batcher.start();

			batcher.stop();

			expect(onFlush).not.toHaveBeenCalled();
		});
	});

	describe("accumulation after partial flush", () => {
		it("starts accumulating again after a flush triggered by maxEntries", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 10_000, maxEntries: 2 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("first"));
			batcher.add(makeEntry("second")); // triggers flush

			expect(onFlush).toHaveBeenCalledOnce();

			batcher.add(makeEntry("third"));
			vi.advanceTimersByTime(10_000);

			expect(onFlush).toHaveBeenCalledTimes(2);
			expect(onFlush.mock.calls[1]![0]).toEqual([expect.objectContaining({ message: "third" })]);
		});

		it("starts accumulating again after a manual flush", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 10_000, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("a"));
			batcher.flush();

			batcher.add(makeEntry("b"));
			batcher.flush();

			expect(onFlush).toHaveBeenCalledTimes(2);
			expect(onFlush.mock.calls[0]![0]).toEqual([expect.objectContaining({ message: "a" })]);
			expect(onFlush.mock.calls[1]![0]).toEqual([expect.objectContaining({ message: "b" })]);
		});
	});

	describe("interval firing", () => {
		it("does not invoke onFlush when empty at interval", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 1000, maxEntries: 10 }, onFlush);
			batcher.start();

			vi.advanceTimersByTime(1000);

			expect(onFlush).not.toHaveBeenCalled();
		});

		it("fires multiple times over multiple intervals", () => {
			const onFlush = vi.fn();
			const batcher = new Batcher({ intervalMs: 500, maxEntries: 100 }, onFlush);
			batcher.start();

			batcher.add(makeEntry("x"));
			vi.advanceTimersByTime(500);

			batcher.add(makeEntry("y"));
			vi.advanceTimersByTime(500);

			expect(onFlush).toHaveBeenCalledTimes(2);
		});
	});
});
