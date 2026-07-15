import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduler } from "../launchpad-scheduler.js";
import type { SchedulerState } from "../scheduler-state.js";

function createStatefulPluginContext() {
	let state: SchedulerState = { jobs: {} };
	const context = createMockPluginCtx();
	const updateState = vi.fn((producer: (draft: SchedulerState) => void) => {
		const nextState: SchedulerState = { jobs: { ...state.jobs } };
		producer(nextState);
		state = nextState;
	});

	return {
		context: { ...context, updateState } as PluginContext<SchedulerState>,
		getState: () => state,
	};
}

describe("scheduler status state", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("publishes full job state for the status snapshot", async () => {
		const { context, getState } = createStatefulPluginContext();
		const plugin = scheduler({ "content.fetch": { interval: "5m", jitter: false } });

		await plugin.setup(context);
		expect(getState().jobs["content.fetch"]).toMatchObject({
			paused: false,
			schedule: { intervalMs: 300_000 },
			attemptCount: 0,
			lastOutcome: null,
			lastErrorMessage: null,
			lastSuccessAt: null,
			nextFireAt: new Date("2026-01-01T12:05:00Z"),
			stoppedWithError: false,
			skippedOverlapCount: 0,
		});

		await vi.advanceTimersByTimeAsync(300_000);
		expect(getState().jobs["content.fetch"]).toMatchObject({
			attemptCount: 0,
			lastOutcome: "success",
			lastSuccessAt: new Date("2026-01-01T12:05:00Z"),
			nextFireAt: new Date("2026-01-01T12:10:00Z"),
		});
	});

	it("returns no section when there are no visible scheduler jobs", () => {
		const emptyState = {
			system: { mode: "persistent" as const, startTime: new Date() },
			plugins: {},
		};
		expect(scheduler({}).summarize?.(emptyState)).toBeNull();
	});
});
