import { randomJitterMs, resolveJitterMs } from "./jitter.js";
import { DEFAULT_BACKOFF, type ResolvedRetry } from "./scheduler-config.js";

/**
 * Computes the delay before the next retry attempt.
 *
 * Grows geometrically from `backoff.initial` by `backoff.factor` per consecutive
 * failure (`attemptCount` is 1 for the first failure), capped at `backoff.max`, with
 * jitter re-rolled on top using the job's normal `jitter` config. `forever: false`
 * jobs don't expose a `backoff` override in config, so they retry on the same default
 * curve as `forever: true` jobs — only whether exhaustion stops the job differs.
 */
export function computeRetryDelayMs(
	attemptCount: number,
	retry: ResolvedRetry,
	jitter: boolean | number,
): number {
	const backoff = retry.forever ? retry.backoff : DEFAULT_BACKOFF;
	const baseDelayMs = Math.min(backoff.initial * backoff.factor ** (attemptCount - 1), backoff.max);
	return baseDelayMs + randomJitterMs(resolveJitterMs(jitter, baseDelayMs));
}
