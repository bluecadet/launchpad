import { computeRetryDelayMs } from "./backoff.js";
import type { ResolvedRetry } from "./scheduler-config.js";

/**
 * Tracks one job's consecutive-failure count and derives its backoff delays.
 *
 * A real dispatch failure advances the attempt count and grows the backoff tier;
 * any success (or an explicit resume) resets it. Overlap skips never reach here —
 * the coordinator keeps them out of retry bookkeeping entirely.
 */
export class RetryPolicy {
	private _attemptCount = 0;

	constructor(
		private readonly _retry: ResolvedRetry,
		private readonly _jitter: boolean | number,
	) {}

	/** Consecutive failures since the last success (or reset). Zero when healthy. */
	get attemptCount(): number {
		return this._attemptCount;
	}

	/** True while a backoff retry loop is in progress (i.e. a failure is outstanding). */
	get isRetrying(): boolean {
		return this._attemptCount > 0;
	}

	/** Delay before the next retry fire, on the current backoff tier with jitter. */
	nextDelayMs(): number {
		return computeRetryDelayMs(this._attemptCount, this._retry, this._jitter);
	}

	/**
	 * Records a real failure and returns whether the job has now exhausted an opt-in
	 * `maxAttempts` policy and should stop. `forever: true` jobs never exhaust.
	 */
	recordFailure(): boolean {
		this._attemptCount += 1;
		return !this._retry.forever && this._attemptCount >= this._retry.maxAttempts;
	}

	/** Clears failure/backoff state after a success or an explicit resume. */
	reset(): void {
		this._attemptCount = 0;
	}
}
