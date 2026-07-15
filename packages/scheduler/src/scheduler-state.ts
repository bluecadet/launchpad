import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { DispatchOutcome } from "./scheduled-job.js";

import "@bluecadet/launchpad-utils/types";

export type SchedulerJobSchedule = { intervalMs: number } | { cron: string };

/** Discriminates the resolved `{ intervalMs } | { cron }` schedule union. */
export function isCronSchedule(schedule: SchedulerJobSchedule): schedule is { cron: string } {
	return "cron" in schedule;
}

export type SchedulerJobState = {
	paused: boolean;
	schedule: SchedulerJobSchedule;
	attemptCount: number;
	lastOutcome: DispatchOutcome | null;
	lastErrorMessage: string | null;
	lastSuccessAt: Date | null;
	nextFireAt: Date | null;
	stoppedWithError: boolean;
	skippedOverlapCount: number;
	isRunning: boolean;
	/** When the current in-flight dispatch began, or `null` when nothing is running. */
	runStartedAt: Date | null;
};

export type SchedulerState = {
	jobs: Partial<Record<CommandId, SchedulerJobState>>;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		scheduler: SchedulerState;
	}
}

export class SchedulerStateManager {
	constructor(private readonly updateState: (producer: (draft: SchedulerState) => void) => void) {
		this.updateState(() => ({ jobs: {} }));
	}

	setJobs(jobs: SchedulerState["jobs"]): void {
		this.updateState((draft) => {
			draft.jobs = jobs;
		});
	}
}
