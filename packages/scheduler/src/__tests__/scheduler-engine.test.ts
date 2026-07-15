import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulerError } from "../errors.js";
import type { DispatchFn } from "../scheduled-job.js";
import { resolveSchedulerConfig } from "../scheduler-config.js";
import { SchedulerEngine } from "../scheduler-engine.js";

function createEngine(dispatch: DispatchFn) {
	const config = resolveSchedulerConfig({
		"content.fetch": { interval: "60s", jitter: false },
		"content.sync": { interval: "60s", jitter: false },
	});
	return new SchedulerEngine(config, { logger: createMockLogger(), dispatch });
}

describe("SchedulerEngine", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("pause/resume scoping", () => {
		it("pauses only the named job, leaving other jobs on their normal cadence", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();

			const result = await engine.pause("content.fetch");
			expect(result.isOk()).toBe(true);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "content.sync" });
		});

		it("pauses every job when `job` is omitted", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();

			await engine.pause();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).not.toHaveBeenCalled();
		});

		it("resumes only the named job", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();
			await engine.pause();

			const result = await engine.resume("content.fetch");
			expect(result.isOk()).toBe(true);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "content.fetch" });
		});

		it("resumes every job when `job` is omitted", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();
			await engine.pause();

			await engine.resume();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("errors cleanly for an unknown job name", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();

			const pauseResult = await engine.pause("content.unknown");
			const resumeResult = await engine.resume("content.unknown");

			expect(pauseResult.isErr()).toBe(true);
			expect(pauseResult._unsafeUnwrapErr().message).toContain("content.unknown");
			expect(resumeResult.isErr()).toBe(true);
			expect(resumeResult._unsafeUnwrapErr().message).toContain("content.unknown");
		});
	});

	describe("enabled: false jobs", () => {
		function createEngineWithDisabledJob(dispatch: DispatchFn) {
			const config = resolveSchedulerConfig({
				"content.fetch": { interval: "60s", jitter: false },
				"content.disabled": { interval: "60s", jitter: false, enabled: false },
			});
			return new SchedulerEngine(config, { logger: createMockLogger(), dispatch });
		}

		it("produces no state entry and never dispatches, even after timer advancement", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngineWithDisabledJob(dispatch);

			engine.start();
			expect(engine.state.jobs).not.toHaveProperty("content.disabled");

			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(dispatch).not.toHaveBeenCalledWith({ type: "content.disabled" });
			expect(engine.state.jobs).not.toHaveProperty("content.disabled");
		});

		it("is not resurrected by a broadcast resume", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngineWithDisabledJob(dispatch);

			engine.start();
			const result = await engine.resume();
			expect(result.isOk()).toBe(true);

			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(dispatch).not.toHaveBeenCalledWith({ type: "content.disabled" });
		});

		it("errors as an unknown job for trigger", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngineWithDisabledJob(dispatch);
			engine.start();

			const result = await engine.trigger("content.disabled");
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(SchedulerError);
			expect(result._unsafeUnwrapErr().message).toContain("content.disabled");
		});

		it("errors as an unknown job for a scoped resume", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngineWithDisabledJob(dispatch);
			engine.start();

			const result = await engine.resume("content.disabled");
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(SchedulerError);
			expect(result._unsafeUnwrapErr().message).toContain("content.disabled");
		});
	});

	describe("trigger", () => {
		it("fires the named job through its ScheduledJob", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();

			const result = await engine.trigger("content.fetch");
			expect(result.isOk()).toBe(true);
			expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "content.fetch" });
		});

		it("errors cleanly for an unknown job name", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const engine = createEngine(dispatch);
			engine.start();

			const result = await engine.trigger("content.unknown");
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("content.unknown");
		});

		it("propagates a dispatch failure from the underlying job", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const engine = createEngine(dispatch);
			engine.start();

			const result = await engine.trigger("content.fetch");
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toBe("boom");
		});

		it("errors if the job is already running", async () => {
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000)),
						(e) => e as Error,
					),
				);
			const engine = createEngine(dispatch);
			engine.start();

			// Both configured jobs share the same 60s interval and dispatch mock, so both
			// tick here; what matters is that content.fetch's own dispatch is still in flight.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalled();

			const result = await engine.trigger("content.fetch");
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("already running");
		});
	});
});
