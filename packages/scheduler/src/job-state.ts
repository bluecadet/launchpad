import type { DispatchOutcome } from "./scheduled-job.js";
import type { ResolvedScheduleSpec } from "./scheduler-config.js";
import type { SchedulerJobSchedule, SchedulerJobState } from "./scheduler-state.js";

/**
 * The mutable status a scheduled job tracks between fires and serializes for the
 * controller-owned snapshot. Attempt/backoff state is owned separately by the
 * job's {@link RetryPolicy}; this is the outcome-and-timing bookkeeping.
 */
export type JobStatus = {
	lastOutcome: DispatchOutcome | null;
	lastErrorMessage: string | null;
	lastSuccessAt: Date | null;
	nextFireAt: Date | null;
	stoppedWithError: boolean;
	/** When the current in-flight dispatch began, or `null` when nothing is running. */
	runStartedAt: Date | null;
};

/** A fresh status for a job that hasn't run yet. */
export function initialJobStatus(): JobStatus {
	return {
		lastOutcome: null,
		lastErrorMessage: null,
		lastSuccessAt: null,
		nextFireAt: null,
		stoppedWithError: false,
		runStartedAt: null,
	};
}

/** Derives the serializable schedule shape from a resolved spec's `interval` XOR `cron`. */
function scheduleFromSpec(spec: ResolvedScheduleSpec): SchedulerJobSchedule {
	return spec.interval !== undefined ? { intervalMs: spec.interval } : { cron: spec.cron ?? "" };
}

/** Assembles a complete, serializable job snapshot for the plugin state. */
export function buildJobState(args: {
	paused: boolean;
	spec: ResolvedScheduleSpec;
	status: JobStatus;
	attemptCount: number;
	skippedOverlapCount: number;
	isRunning: boolean;
}): SchedulerJobState {
	return {
		paused: args.paused,
		schedule: scheduleFromSpec(args.spec),
		attemptCount: args.attemptCount,
		lastOutcome: args.status.lastOutcome,
		lastErrorMessage: args.status.lastErrorMessage,
		lastSuccessAt: args.status.lastSuccessAt,
		nextFireAt: args.status.nextFireAt,
		stoppedWithError: args.status.stoppedWithError,
		skippedOverlapCount: args.skippedOverlapCount,
		isRunning: args.isRunning,
		runStartedAt: args.status.runStartedAt,
	};
}
