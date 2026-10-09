import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { DispatchOutcome } from "./scheduled-job.js";
import type { SchedulerJobState, SchedulerState } from "./scheduler-state.js";

const DISPATCH_OUTCOMES: readonly DispatchOutcome[] = ["success", "overlapSkip", "failure"];

function toUnixSeconds(date: Date | null | undefined): number | undefined {
	if (!(date instanceof Date)) return undefined;
	const milliseconds = date.getTime();
	return Number.isFinite(milliseconds) ? milliseconds / 1_000 : undefined;
}

function projectJobMetrics(job: string, state: SchedulerJobState): readonly MetricObservation[] {
	const attributes = { job };
	const observations: MetricObservation[] = [
		{
			name: "launchpad_scheduler_job_running",
			value: state.isRunning ? 1 : 0,
			description: "Whether the scheduled job currently has a dispatch in flight.",
			attributes,
		},
		{
			name: "launchpad_scheduler_job_overlap_skips",
			value: state.skippedOverlapCount,
			description: "Current number of dispatches skipped because the job overlapped.",
			attributes,
		},
		{
			name: "launchpad_scheduler_job_retry_attempt",
			value: state.attemptCount,
			description: "Current consecutive failed attempt count for the scheduled job.",
			attributes,
		},
	];

	const lastSuccessAt = toUnixSeconds(state.lastSuccessAt);
	if (lastSuccessAt !== undefined) {
		observations.push({
			name: "launchpad_scheduler_job_last_success_seconds",
			value: lastSuccessAt,
			unit: "s",
			description: "UNIX time when the scheduled job's latest successful dispatch completed.",
			attributes,
		});
	}

	if (state.lastOutcome) {
		for (const outcome of DISPATCH_OUTCOMES) {
			observations.push({
				name: "launchpad_scheduler_job_last_outcome",
				value: state.lastOutcome === outcome ? 1 : 0,
				description: "Whether the scheduled job's latest dispatch had the named outcome.",
				attributes: { job, outcome },
			});
		}
	}

	return observations;
}

/** Projects safe gauge observations from the scheduler plugin's current state. */
export function projectSchedulerMetrics(
	state: SchedulerState | null | undefined,
	configuredJobIds: ReadonlySet<string>,
): readonly MetricObservation[] {
	if (!state) return [];

	const observations: MetricObservation[] = [];
	for (const [job, jobState] of Object.entries(state.jobs)) {
		if (!jobState || !configuredJobIds.has(job)) continue;
		observations.push(...projectJobMetrics(job, jobState));
	}
	return observations;
}
