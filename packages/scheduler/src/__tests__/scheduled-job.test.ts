import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { CommandInProgressError } from "@bluecadet/launchpad-utils/command-guard";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledJob } from "../scheduled-job.js";
import { resolveSchedulerConfig, type ScheduleSpec } from "../scheduler-config.js";
import { buildSchedulerSection } from "../scheduler-summarize.js";

/** Renders the scheduler status row for a single job from its live state snapshot. */
function jobStatusRow(job: ScheduledJob) {
	const section = buildSchedulerSection({ jobs: { "content.fetch": job.state } });
	const row = section.rows[0];
	if (!row || row.type !== "kv") throw new Error("Expected a scheduler kv row");
	return row;
}

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

		it("never self-overlaps when a dispatch outlasts the interval, anchoring the next fire to completion", async () => {
			// A 90s dispatch on a 60s interval: the run is still in flight across the t=120s
			// boundary where a start-anchored scheduler would fire again. This test fails under
			// start-anchoring (which would show 2 dispatches by t=149s, one of them mid-flight).
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 90_000)),
						(e) => e as Error,
					),
				);
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();

			// First tick fires at t=60s and runs until t=150s. Through the whole in-flight
			// window — including past the t=120s start-anchored boundary — only one dispatch.
			await vi.advanceTimersByTimeAsync(149_999);
			expect(dispatch).toHaveBeenCalledTimes(1);

			// The dispatch completes at t=150s; the next fire anchors to that completion and
			// waits a full interval, so nothing fires at the completion instant itself.
			await vi.advanceTimersByTimeAsync(1); // t=150_000, dispatch resolves
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Second dispatch fires one interval after completion (t=210s), never mid-flight.
			await vi.advanceTimersByTimeAsync(59_999); // t=209_999
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1); // t=210_000
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

		it("with default jitter, fires within 60s of a nightly occurrence, never hours late", async () => {
			// Start just after 3am so the next "0 3 * * *" occurrence is ~24h out — the gap
			// whose 10% would have been ~2.4h under the old percentage-of-gap jitter rule.
			vi.setSystemTime(new Date("2026-01-01T03:00:01Z"));
			const gapMs = 24 * 60 * 60 * 1000 - 1000;
			vi.spyOn(Math, "random").mockReturnValue(0.9999); // worst-case jitter draw

			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			// No jitter override: it defaults to `true`, which the cron path caps at 60s.
			const job = new ScheduledJob(
				"content.sync",
				getSpec({ interval: undefined, cron: "0 3 * * *" }),
				{ logger, dispatch },
			);

			job.start();
			// Nothing fires before the wall-clock occurrence.
			await vi.advanceTimersByTimeAsync(gapMs - 1);
			expect(dispatch).not.toHaveBeenCalled();

			// By 60s past the occurrence it has fired — not hours late.
			await vi.advanceTimersByTimeAsync(1 + 60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
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

			it("a success mid-retry resets backoff and resumes the normal wall-clock cadence", async () => {
				const dispatch = vi
					.fn()
					.mockReturnValueOnce(errAsync(new Error("boom")))
					.mockReturnValue(okAsync(undefined));
				const job = new ScheduledJob(
					"content.sync",
					getSpec({ interval: undefined, cron: "0 3 * * *", jitter: false }),
					{ logger, dispatch },
				);

				job.start();
				await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000); // t=3h: first occurrence fails
				expect(job.attemptCount).toBe(1);

				await vi.advanceTimersByTimeAsync(15_000); // retry succeeds, resets backoff
				expect(dispatch).toHaveBeenCalledTimes(2);
				expect(job.attemptCount).toBe(0);
				expect(job.lastOutcome).toBe("success");

				// Next fire resumes the normal daily wall-clock cadence (next 3am, 24h after the
				// *original* occurrence, i.e. 24h minus the 15s already spent retrying) — not
				// another backoff tier anchored to the retry's own completion time.
				const remainingUntilNextOccurrence = 24 * 60 * 60 * 1000 - 15_000;
				await vi.advanceTimersByTimeAsync(remainingUntilNextOccurrence - 1);
				expect(dispatch).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(1);
				expect(dispatch).toHaveBeenCalledTimes(3);
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

	describe("pause", () => {
		it("cancels a pending retry timer mid-backoff", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000); // attempt 1 fails, retry armed for +15s
			expect(dispatch).toHaveBeenCalledTimes(1);

			job.pause();
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(dispatch).toHaveBeenCalledTimes(1);
		});
	});

	describe("resume", () => {
		it("re-anchors the job from `now`, discarding backoff state accumulated before the pause", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000); // attempt 1 fails
			expect(job.attemptCount).toBe(1);

			job.pause();
			await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // long gap while paused

			job.resume();
			expect(job.attemptCount).toBe(0);
			expect(job.stoppedWithError).toBe(false);
			dispatch.mockReturnValue(okAsync(undefined));

			// Fresh 60s interval from the resume point, not a leftover 15s backoff retry.
			await vi.advanceTimersByTimeAsync(59_999);
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("revives a job that had exhausted under a maxAttempts policy", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("network down")));
			const job = new ScheduledJob(
				"content.fetch",
				getSpec({ interval: "60s", jitter: false, retry: { forever: false, maxAttempts: 1 } }),
				{ logger, dispatch },
			);

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(job.stoppedWithError).toBe(true);

			job.resume();
			expect(job.stoppedWithError).toBe(false);

			dispatch.mockReturnValue(okAsync(undefined));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});
	});

	describe("trigger", () => {
		it("fires immediately and re-anchors the next tick from its own completion", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(30_000); // halfway through the normal 60s tick

			const result = await job.trigger();
			expect(result.isOk()).toBe(true);
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Next tick is 60s from the trigger's completion, not from the original 60s mark
			// (which would have fired 30s from here and caused a near-double-fire).
			await vi.advanceTimersByTimeAsync(59_999);
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(2);
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
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);

			const result = await job.trigger();
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("already running");
			expect(dispatch).toHaveBeenCalledTimes(1);
		});

		it("revives an exhausted job", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("network down")));
			const job = new ScheduledJob(
				"content.fetch",
				getSpec({ interval: "60s", jitter: false, retry: { forever: false, maxAttempts: 1 } }),
				{ logger, dispatch },
			);

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(job.stoppedWithError).toBe(true);

			dispatch.mockReturnValue(okAsync(undefined));
			const result = await job.trigger();

			expect(result.isOk()).toBe(true);
			expect(job.stoppedWithError).toBe(false);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});

		it("propagates a real dispatch failure to the caller without changing the retry cadence", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			const result = await job.trigger();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toBe("boom");
			expect(job.attemptCount).toBe(1);
		});

		it("fires a paused job once but leaves it paused, unlike reviving an exhausted job", async () => {
			const dispatch = vi.fn().mockReturnValue(okAsync(undefined));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			job.pause();

			const result = await job.trigger();
			expect(result.isOk()).toBe(true);
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Trigger fired the job once, but pause's contract ("stops future ticks") isn't
			// silently undone — only an explicit resume() re-arms the normal cadence.
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
			expect(dispatch).toHaveBeenCalledTimes(1);
		});

		it("cancels a cron job's pre-armed wall-clock timer, avoiding a near-double-fire with a slow trigger", async () => {
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20_000)),
						(e) => e as Error,
					),
				);
			const job = new ScheduledJob(
				"content.sync",
				getSpec({ interval: undefined, cron: "0 3 * * *", jitter: false }),
				{ logger, dispatch },
			);

			job.start(); // pre-arms the 3am occurrence at t=3h
			await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 - 10_000); // t = 3h minus 10s

			const triggerPromise = job.trigger();
			expect(dispatch).toHaveBeenCalledTimes(1);

			// Without cancelling the pre-armed 3am timer, it would fire again right here —
			// 10s after the trigger, while the manual dispatch (20s) is still in flight.
			await vi.advanceTimersByTimeAsync(10_000); // t = 3h
			expect(dispatch).toHaveBeenCalledTimes(1);

			// The manual dispatch completes 10s later, at t = 3h + 10s — after today's 3am
			// occurrence, so the recomputed next occurrence skips to tomorrow's 3am.
			await vi.advanceTimersByTimeAsync(10_000);
			const result = await triggerPromise;
			expect(result.isOk()).toBe(true);
			expect(dispatch).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 10_000 - 1);
			expect(dispatch).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(dispatch).toHaveBeenCalledTimes(2);
		});
	});

	describe("running-for status row", () => {
		it("renders the running row with the run's age mid-dispatch, then the normal row once it completes", async () => {
			// A dispatch that wedges for 40 minutes — well past 10x the 60s interval.
			const dispatch = vi
				.fn()
				.mockImplementation(() =>
					ResultAsync.fromPromise(
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 40 * 60_000)),
						(e) => e as Error,
					),
				);
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000); // first tick fires; dispatch now in flight
			expect(job.isRunning).toBe(true);

			// 3 minutes into the stuck dispatch: honest run age, still ok-toned.
			await vi.advanceTimersByTimeAsync(3 * 60_000);
			const runningRow = jobStatusRow(job);
			expect(runningRow.value).toBe("every 1m · running · started 3m ago");
			expect(runningRow.tone).toBe("ok");

			// Past 10x the interval (~11m in flight): the same row escalates to warn.
			await vi.advanceTimersByTimeAsync(8 * 60_000);
			expect(jobStatusRow(job).tone).toBe("warn");

			// Let the dispatch finish; the row returns to the normal completed cadence.
			await vi.advanceTimersByTimeAsync(29 * 60_000); // t=41m: dispatch resolves
			expect(job.isRunning).toBe(false);
			const doneRow = jobStatusRow(job);
			expect(doneRow.value).toContain("last ok");
			expect(doneRow.tone).toBe("ok");
		});
	});
});
