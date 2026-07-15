import { createCronNextRun } from "./cron.js";
import { randomJitterMs, resolveCronJitterMs, resolveJitterMs } from "./jitter.js";
import type { ResolvedScheduleSpec } from "./scheduler-config.js";

/** Computes the delay in ms until a job's next fire, given the point in time to compute from. */
export type DelayFn = (from: Date) => number;

/**
 * Interval delays never depend on wall-clock alignment: it's always the configured
 * interval plus a freshly-rolled jitter contribution, regardless of `from`.
 */
export function createIntervalDelay(intervalMs: number, jitter: boolean | number): DelayFn {
	return () => intervalMs + randomJitterMs(resolveJitterMs(jitter, intervalMs));
}

/**
 * Cron delays are wall-clock anchored: the base delay is however long until the next
 * matching occurrence after `from`. Jitter is a small fixed fleet-desync amount (see
 * {@link resolveCronJitterMs}) rather than a percentage of the gap, so it never shifts
 * the occurrence meaningfully off its wall-clock time.
 */
export function createCronDelay(cronExpression: string, jitter: boolean | number): DelayFn {
	const nextRun = createCronNextRun(cronExpression);
	return (from: Date) => {
		const next = nextRun(from);
		const baseDelayMs = next ? Math.max(0, next.getTime() - from.getTime()) : 0;
		return baseDelayMs + randomJitterMs(resolveCronJitterMs(jitter));
	};
}

/** Builds the right delay function for a resolved schedule spec's `interval` XOR `cron`. */
export function createDelayFn(spec: ResolvedScheduleSpec): DelayFn {
	if (spec.cron !== undefined) {
		return createCronDelay(spec.cron, spec.jitter);
	}
	// `scheduleObjectSchema`'s `.superRefine` guarantees exactly one of `interval`/`cron` is set,
	// so `interval` is defined whenever `cron` isn't — TS can't express that XOR structurally.
	return createIntervalDelay(spec.interval as number, spec.jitter);
}
