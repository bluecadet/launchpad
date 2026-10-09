import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduler } from "../launchpad-scheduler.js";
import { projectSchedulerMetrics } from "../scheduler-metrics.js";
import type { SchedulerJobState, SchedulerState } from "../scheduler-state.js";

function launchpadState(schedulerState?: SchedulerState): LaunchpadState {
	return {
		system: { startTime: new Date(0), mode: "persistent" },
		plugins: schedulerState ? { scheduler: schedulerState } : {},
	};
}

function jobState(overrides: Partial<SchedulerJobState> = {}): SchedulerJobState {
	return {
		paused: false,
		schedule: { intervalMs: 300_000 },
		attemptCount: 0,
		lastOutcome: null,
		lastErrorMessage: null,
		lastSuccessAt: null,
		nextFireAt: null,
		stoppedWithError: false,
		skippedOverlapCount: 0,
		isRunning: false,
		runStartedAt: null,
		...overrides,
	};
}

describe("scheduler metric observations", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns no observations when scheduler state is missing or null", () => {
		const plugin = scheduler({});

		expect(plugin.observe?.(launchpadState())).toEqual([]);
		expect(projectSchedulerMetrics(null, new Set())).toEqual([]);
	});

	it("projects current gauges, seconds, and the real dispatch outcome enum", async () => {
		const plugin = scheduler({ "content.fetch": { interval: "5m", jitter: false } });
		const setupResult = await plugin.setup(createMockPluginCtx());
		expect(setupResult).toBeOk();

		const observations =
			plugin.observe?.(
				launchpadState({
					jobs: {
						"content.fetch": jobState({
							attemptCount: 2,
							lastOutcome: "overlapSkip",
							lastSuccessAt: new Date("2024-01-02T03:04:05.000Z"),
							skippedOverlapCount: 7,
							isRunning: true,
						}),
						"monitor.start": jobState({ lastOutcome: "success" }),
					},
				}),
			) ?? [];

		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "launchpad_scheduler_job_running",
					value: 1,
					attributes: { job: "content.fetch" },
				}),
				expect.objectContaining({
					name: "launchpad_scheduler_job_overlap_skips",
					value: 7,
					attributes: { job: "content.fetch" },
				}),
				expect.objectContaining({
					name: "launchpad_scheduler_job_retry_attempt",
					value: 2,
					attributes: { job: "content.fetch" },
				}),
				expect.objectContaining({
					name: "launchpad_scheduler_job_last_success_seconds",
					value: Date.parse("2024-01-02T03:04:05.000Z") / 1_000,
					unit: "s",
					attributes: { job: "content.fetch" },
				}),
				expect.objectContaining({
					name: "launchpad_scheduler_job_last_outcome",
					value: 1,
					attributes: { job: "content.fetch", outcome: "overlapSkip" },
				}),
			]),
		);
		const outcomes = observations.filter(
			(observation) => observation.name === "launchpad_scheduler_job_last_outcome",
		);
		expect(outcomes).toEqual([
			expect.objectContaining({
				value: 0,
				attributes: { job: "content.fetch", outcome: "success" },
			}),
			expect.objectContaining({
				value: 1,
				attributes: { job: "content.fetch", outcome: "overlapSkip" },
			}),
			expect.objectContaining({
				value: 0,
				attributes: { job: "content.fetch", outcome: "failure" },
			}),
		]);
		expect(observations).toHaveLength(7);
		expect(
			observations.some((observation) => observation.attributes?.job === "monitor.start"),
		).toBe(false);

		await setupResult._unsafeUnwrap().disconnect?.({ type: "manual" });
	});

	it("skips unavailable success time and last outcome instead of reporting zero", () => {
		const observations = projectSchedulerMetrics(
			{ jobs: { "content.fetch": jobState() } },
			new Set(["content.fetch"]),
		);

		expect(observations).toHaveLength(3);
		expect(
			observations.some(
				(observation) =>
					observation.name === "launchpad_scheduler_job_last_success_seconds" ||
					observation.name === "launchpad_scheduler_job_last_outcome",
			),
		).toBe(false);
	});
});
