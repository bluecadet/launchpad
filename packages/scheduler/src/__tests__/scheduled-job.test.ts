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

		it("treats a real command failure like a success for scheduling purposes", async () => {
			const dispatch = vi.fn().mockReturnValue(errAsync(new Error("boom")));
			const job = new ScheduledJob("content.fetch", getSpec({ interval: "60s", jitter: false }), {
				logger,
				dispatch,
			});

			job.start();
			await vi.advanceTimersByTimeAsync(60_000);
			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(60_000);
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
