import {
	formatClockTime,
	formatDurationMs,
	formatTimeAgo,
	formatTimeUntil,
} from "@bluecadet/launchpad-utils/status-format";
import type { Row, Section, Tone } from "@bluecadet/launchpad-utils/types";
import { isCronSchedule, type SchedulerJobState, type SchedulerState } from "./scheduler-state.js";

const ERROR_FRAGMENT_MAX_LENGTH = 80;

/**
 * How many interval lengths a run may span before its row escalates from `ok` to
 * `warn`. Completion-anchoring means a healthy run finishes within one interval, so a
 * run still in flight after this many intervals is almost certainly a wedged dispatch
 * (see the hung-command limitation in the scheduler reference docs).
 */
const RUN_AGE_WARN_INTERVAL_MULTIPLE = 10;

function formatSchedule(job: SchedulerJobState): string {
	return isCronSchedule(job.schedule)
		? `cron ${job.schedule.cron}`
		: `every ${formatDurationMs(job.schedule.intervalMs)}`;
}

function formatNextRun(job: SchedulerJobState, now: Date): string {
	if (!job.nextFireAt) return "next run unavailable";
	const relative = formatTimeUntil(job.nextFireAt, now);
	return isCronSchedule(job.schedule)
		? `next ${formatClockTime(job.nextFireAt)} (${relative})`
		: `next ${relative}`;
}

function truncateError(error: string): string {
	const firstLine = error.split(/\r?\n/, 1)[0] ?? "";
	return firstLine.length <= ERROR_FRAGMENT_MAX_LENGTH
		? firstLine
		: `${firstLine.slice(0, ERROR_FRAGMENT_MAX_LENGTH - 3)}...`;
}

function errorFragment(error: string | null): string {
	return `last error: ${truncateError(error ?? "Unknown error")}`;
}

/**
 * A run still in flight stays `ok` while it's within a generous multiple of the
 * interval, then escalates to `warn` — the operator-facing signal that an interval
 * job's dispatch has likely wedged. Cron runs have no interval to measure against, so
 * they stay `ok` (a wedged cron job surfaces as overlap skips instead).
 */
function runningTone(job: SchedulerJobState, now: Date): Tone {
	if (isCronSchedule(job.schedule) || !job.runStartedAt) return "ok";
	const elapsedMs = now.getTime() - job.runStartedAt.getTime();
	return elapsedMs > job.schedule.intervalMs * RUN_AGE_WARN_INTERVAL_MULTIPLE ? "warn" : "ok";
}

function jobRow(commandId: string, job: SchedulerJobState, now: Date): Row | null {
	let value: string;
	let tone: Tone;
	if (job.paused) {
		value = "paused";
		tone = "neutral";
	} else if (job.stoppedWithError) {
		value = `gave up after ${job.attemptCount} attempts · ${errorFragment(job.lastErrorMessage)}`;
		tone = "error";
	} else if (job.attemptCount > 0) {
		value = `retrying (attempt ${job.attemptCount}) · next retry ${formatTimeUntil(
			job.nextFireAt ?? now,
			now,
		)} · ${errorFragment(job.lastErrorMessage)}`;
		tone = "warn";
	} else if (job.isRunning && job.runStartedAt) {
		value = `${formatSchedule(job)} · running · started ${formatTimeAgo(job.runStartedAt, now)}`;
		tone = runningTone(job, now);
	} else if (job.lastOutcome === "overlapSkip") {
		value = `${formatSchedule(job)} · last run skipped (command busy) · ${formatNextRun(job, now)}`;
		tone = "ok";
	} else if (job.lastOutcome === "success" && job.lastSuccessAt) {
		value = `${formatSchedule(job)} · last ok ${formatTimeAgo(job.lastSuccessAt, now)} · ${formatNextRun(job, now)}`;
		tone = "ok";
	} else {
		const nextRun = job.nextFireAt
			? isCronSchedule(job.schedule)
				? `${formatClockTime(job.nextFireAt)} (${formatTimeUntil(job.nextFireAt, now)})`
				: formatTimeUntil(job.nextFireAt, now)
			: formatTimeUntil(now, now);
		value = `${formatSchedule(job)} · first run ${nextRun}`;
		tone = "ok";
	}

	return { type: "kv", label: commandId, value, tone };
}

export function buildSchedulerSection(schedulerState: SchedulerState, now = new Date()): Section {
	const rows = Object.entries(schedulerState.jobs).flatMap(([commandId, job]) => {
		if (!job) return [];
		const row = jobRow(commandId, job, now);
		return row ? [row] : [];
	});

	return { name: "scheduler", order: 30, title: "Scheduler", rows };
}
