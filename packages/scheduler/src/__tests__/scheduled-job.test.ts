import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { CommandInProgressError } from "@bluecadet/launchpad-utils/command-guard";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledJob } from "../scheduled-job.js";
import { resolveSchedulerConfig, type ScheduleSpec } from "../scheduler-config.js";

function getSpec(overrides: Record<string, unknown> = {}) {
	const resolved = resolveSchedulerConfig({
		"content.fetch": { interval: "60s", ...overrides } as ScheduleSpec,
	});
	const spec = resolved["content.fetch"];
	if (!spec) throw new Error("Expected resolved spec for content.fetch");
	return spec;
}

describe("ScheduledJob", () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		// Cron wall-clock semantics are intentionally local-timezone (kiosk business hours);
		// pin to UTC here so the cron-job assertions below are portable across CI machines.
		process.env.TZ = "UTC";
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("interval jobs", () => {
		it("anchors the next tick to completion, not to the previous fire time", async () => {
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000)),
						(e) => e as Error,
					),
				);
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Dispatch is still in flight (takes 10s); no next tick should be scheduled yet.
			await vi.advanceTimersByTimeAsync(59_999);
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Dispatch completes at t=70s; next tick anchors 60s from there (t=130s), not from
			// the fire time (which would have been t=120s).
			await vi.advanceTimersByTimeAsync(10_000); // t=129_999
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1); // t=130_000
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("enters its own retry loop on failure instead of waiting the full interval", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalled();

			// Default backoff.initial (15s) fires the retry well before the next 60s interval tick.
			await vi.advanceTimersByTimeAsync(15_000);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("treats CommandInProgressError as a skip: no failure log, counter increments, next tick on time", async () => {
			const overlapError = new Error("Plugin command execution failed", {
				cause: new CommandInProgressError(),
			});
			const dispatch = vi.fn().mockReturnValue(errAsync(overlapError));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(job.skippedOverlapCount).toBe(1);
			expect(logger.error).not.toHaveBeenCalled();
			expect(logger.info).toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(2);
			expect(job.skippedOverlapCount).toBe(2);
		});
	});

	describe("cron jobs", () => {
		it("fires at the wall-clock occurrence and schedules the next one up front", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob(
				"content.sync",
				getSpec({ interval: undefined, cron: "0 3 * * *", jitter: false }),
				{
					logger,
					dispatch,
				},
			);

			job.start();
			await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 - 1);
			expect(dispatch).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 1);
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("skips an overlap without disrupting the wall-clock cadence", async () => {
			const overlapError = new Error("Plugin command execution failed", {
				cause: new CommandInProgressError(),
			});
			const dispatch = vi.fn().mockReturnValue(errAsync(overlapError));
			const job = new ScheduledJob(
				"content.sync",
				getSpec({ interval: undefined, cron: "* * * * *", jitter: false }),
				{
					logger,
					dispatch,
				},
			);

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(job.skippedOverlapCount).toBe(1);
			expect(logger.error).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(2);
			expect(job.skippedOverlapCount).toBe(2);
		});
	});

	describe("retry", () => {
		describe("interval jobs", () => {
			it("grows backoff geometrically per consecutive failure, capped at backoff.max", async () => {
				const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
				const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
					logger,
					dispatch,
				});

				job.start();
				await vi.advanceTimersByTimeAsync(60_000); // attempt 1 fails
				expect(dispatch).toHaveBeenCalledTimes(1);

				await vi.advanceTimersByTimeAsync(15_000); // attempt 2 (retry after 15s)
				expect(dispatch).toHaveBeenCalledTimes(2);

				await vi.advanceTimersByTimeAsync(30_000); // attempt 3 (retry after 30s)
				expect(dispatch).toHaveBeenCalledTimes(3);

				await vi.advanceTimersByTimeAsync(60_000); // attempt 4 (retry after 60s)
				expect(dispatch).toHaveBeenCalledTimes(4);

				await vi.advanceTimersByTimeAsync(120_000); // attempt 5 (retry after 120s)
				expect(dispatch).toHaveBeenCalledTimes(5);

				await vi.advanceTimersByTimeAsync(240_000); // attempt 6 (retry after 240s)
				expect(dispatch).toHaveBeenCalledTimes(6);

				// Growth caps at backoff.max (5m) from here on.
				await vi.advanceTimersByTimeAsync(300_000);
				expect(dispatch).toHaveBeenCalledTimes(7);
				await vi.advanceTimersByTimeAsync(300_000);
				expect(dispatch).toHaveBeenCalledTimes(8);
			});

			it("resets backoff fully on success, resuming the normal interval cadence", async () => {
				const dispatch = vi
					.fn()
					.mockReturnValueOnce(errAsync(new Error("boom")))
					.mockReturnValue(okAsync(undefined));
				const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
					logger,
					dispatch,
				});

				job.start();
				await vi.advanceTimersByTimeAsync(60_000); // t=60s: first dispatch fails
				expect(dispatch).toHaveBeenCalledTimes(1);
				expect(job.attemptCount).toBe(1);

				await vi.advanceTimersByTimeAsync(15_000); // t=75s: retry fires, succeeds
				expect(dispatch).toHaveBeenCalledTimes(2);
				expect(job.attemptCount).toBe(0);
				expect(job.lastOutcome).toBe("success");
				expect(job.lastErrorMessage).toBeNull();

				// Next tick resumes the normal 60s cadence, not another backoff-scale delay.
				await vi.advanceTimersByTimeAsync(59_999);
				expect(dispatch).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(1);
				expect(dispatch).toHaveBeenCalledTimes(3);
			});

			it("re-rolls jitter on retry fires using the current backoff tier, not the interval", async () => {
				const dispatch = vi
					.fn()
					.mockReturnValueOnce(errAsync(new Error("boom")))
					.mockReturnValue(okAsync(undefined));
				const randomSpy = vi.spyOn(Math, "random");
				randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0.5);

				const job = new ScheduledJob("content.fetch", getSpec({ interval: "100s", jitter: true }), {
					logger,
					dispatch,
				});
				const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

				job.start();
				expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(100_000); // random()=0 => no jitter

				await vi.advanceTimersByTimeAsync(100_000);
				expect(dispatch).toHaveBeenCalledTimes(1);

				// backoff.initial (15s) + 10% jitter at random()=0.5 => 15_000 + 750 = 15_750.
				const retryDelay = setTimeoutSpy.mock.calls.at(-1)?.[1];
				expect(retryDelay).toBe(15_750);

				await vi.advanceTimersByTimeAsync(retryDelay ?? 0);
				expect(dispatch).toHaveBeenCalledTimes(2);
			});

			it("never exhausts under the default forever policy, however many consecutive failures occur", async () => {
				const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
				const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
					logger,
					dispatch,
				});

				job.start();
				await vi.advanceTimersByTimeAsync(60_000);
				// Fast-forward through many consecutive backoff-capped retries.
				await vi.advanceTimersByTimeAsync(20 * 300_000);

				expect(job.stoppedWithError).toBe(false);
				expect(dispatch.mock.calls.length).toBeGreaterThan(10);
			});
		});

		describe("overlap skip mid-retry-loop", () => {
			it("does not consume an attempt or change backoff", async () => {
				const boom = new Error("boom");
				const overlapError = new Error("Plugin command execution failed", {
					cause: new CommandInProgressError(),
				});
				const dispatch = vi
					.fn()
					.mockReturnValueOnce(errAsync(boom)) // attempt 1: real failure
					.mockReturnValueOnce(errAsync(overlapError)) // retry #1: overlap skip
					.mockReturnValue(errAsync(boom)); // retry #2: real failure again

				const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
					logger,
					dispatch,
				});

				job.start();
				await vi.advanceTimersByTimeAsync(60_000); // attempt 1 fails
				expect(job.attemptCount).toBe(1);

				await vi.advanceTimersByTimeAsync(15_000); // retry #1: overlap skip
				expect(dispatch).toHaveBeenCalledTimes(2);
				expect(job.skippedOverlapCount).toBe(1);
				expect(job.attemptCount).toBe(1); // unchanged by the skip
				expect(job.lastOutcome).toBe("overlapSkip");

				// The next retry still fires on the same (attempt 1) tier — 15s, not 30s.
				await vi.advanceTimersByTimeAsync(15_000);
				expect(dispatch).toHaveBeenCalledTimes(3);
				expect(job.attemptCount).toBe(2); // this one's a real failure, so it does advance
			});
		});

		describe("cron jobs", () => {
			it("a failure preempts the pre-armed wall-clock timer with a backoff retry", async () => {
				const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
				const job = new ScheduledJob(
					"content.sync",
					getSpec({ interval: undefined, cron: "0 3 * * *", jitter: false }),
					{ logger, dispatch },
				);

				job.start();
				await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // t=3h: first occurrence fails
				expect(dispatch).toHaveBeenCalledTimes(1);

				// Without retry this would wait ~24h for the next occurrence; backoff fires in 15s.
				await vi.advanceTimersByTimeAsync(14_999);
				expect(dispatch).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(1);
				expect(dispatch).toHaveBeenCalledTimes(2);
			});

			it("overlap skip mid-retry leaves the already-armed backoff timer untouched", async () => {
				const boom = new Error("boom");
				const overlapError = new Error("Plugin command execution failed", {
					cause: new CommandInProgressError(),
				});
				const dispatch = vi
					.fn()
					.mockReturnValueOnce(errAsync(boom))
					.mockReturnValueOnce(errAsync(overlapError))
					.mockReturnValue(okAsync(undefined));

				const job = new ScheduledJob(
					"content.sync",
					getSpec({ interval: undefined, cron: "0 3 * * *", jitter: false }),
					{ logger, dispatch },
				);

				job.start();
				await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // first occurrence fails
				expect(job.attemptCount).toBe(1);

				await vi.advanceTimersByTimeAsync(15_000); // retry #1: overlap skip
				expect(job.attemptCount).toBe(1);
				expect(job.skippedOverlapCount).toBe(1);

				await vi.advanceTimersByTimeAsync(15_000); // retry #2: succeeds, resets backoff
				expect(dispatch).toHaveBeenCalledTimes(3);
				expect(job.attemptCount).toBe(0);
			});
		});

		describe("maxAttempts (forever: false)", () => {
			it("stops the job after exhausting maxAttempts, recording the error state", async () => {
				const dispatch = vi.fn().mockReturnValue(errAsync(new Error("network down")));
				const job = new ScheduledJob(
					"content.fetch",
					getSpec({ interval: "60s", jitter: false, retry: { forever: false, maxAttempts: 3 } }),
					{ logger, dispatch },
				);

				job.start();
				await vi.advanceTimersByTimeAsync(60_000); // attempt 1
				expect(dispatch).toHaveBeenCalledTimes(1);
				expect(job.stoppedWithError).toBe(false);

				await vi.advanceTimersByTimeAsync(15_000); // attempt 2 (retry)
				expect(dispatch).toHaveBeenCalledTimes(2);
				expect(job.stoppedWithError).toBe(false);

				await vi.advanceTimersByTimeAsync(30_000); // attempt 3 — exhausts maxAttempts
				expect(dispatch).toHaveBeenCalledTimes(3);
				expect(job.stoppedWithError).toBe(true);
				expect(job.lastErrorMessage).toBe("network down");
				expect(job.nextFireAt).toBeNull();

				// No further dispatches ever, regardless of how much time passes.
				await vi.advanceTimersByTimeAsync(10 * 60_000);
				expect(dispatch).toHaveBeenCalledTimes(3);
			});

			it("uses the same default backoff curve as forever:true jobs (no per-job override exists)", async () => {
				const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
				const job = new ScheduledJob(
					"content.fetch",
					getSpec({ interval: "60s", jitter: false, retry: { forever: false, maxAttempts: 5 } }),
					{ logger, dispatch },
				);

				job.start();
				await vi.advanceTimersByTimeAsync(60_000); // attempt 1
				await vi.advanceTimersByTimeAsync(15_000); // attempt 2 (15s tier)
				expect(dispatch).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(30_000); // attempt 3 (30s tier)
				expect(dispatch).toHaveBeenCalledTimes(3);
			});
		});
	});

	describe("jitter", () => {
		it("rerolls a fresh jitter contribution on every scheduled tick", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const randomSpy = vi.spyOn(Math, "random");
			randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0.5);

			const job = new ScheduledJob("content.fetch", getSpec({ interval: "100s", jitter: true }), {
				logger,
				dispatch,
			});
			const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

			job.start();
			// random()=0 => 100_000 + 0
			expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(100_000);

			await vi.advanceTimersByTimeAsync(100_000);
			// random()=0.5 => 100_000 + (100_000 * 0.1 * 0.5) = 105_000
			const secondDelay = setTimeoutSpy.mock.calls.at(-1)?.[1];
			expect(secondDelay).toBe(105_000);
			expect(secondDelay).not.toBe(setTimeoutSpy.mock.calls[0]?.[1]);
		});
	});

	describe("runOnStart", () => {
		it("waits one full interval before the first dispatch when false", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob(
				"content.fetch",
				getSpec({ interval: "60s", jitter: false, runOnStart: false }),
				{ logger, dispatch },
			);

			job.start();
			expect(dispatch).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(59_999);
			expect(dispatch).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(1);
		});

		it("dispatches immediately at start when true, then resumes the normal cadence", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob(
				"content.fetch",
				getSpec({ interval: "60s", jitter: false, runOnStart: true }),
				{ logger, dispatch },
			);

			job.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(dispatch).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(59_999);
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});
	});

	describe("enabled: false", () => {
		it("never schedules or dispatches", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", enabled: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(dispatch).not.toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("cancels the pending timer so no further dispatches occur", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			job.stop();
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(dispatch).not.toHaveBeenCalled();
		});

		it("lets an in-flight dispatch finish but does not schedule another tick", async () => {
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000)),
						(e) => e as Error,
					),
				);
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);

			job.stop();
			await vi.advanceTimersByTimeAsync(10_000 + 60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
		});
	});
});
