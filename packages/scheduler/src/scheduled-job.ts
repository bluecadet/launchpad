import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { ResultAsync } from "neverthrow";
import { computeRetryDelayMs } from "./backoff.js";
import { isOverlapSkipError } from "./overlap.js";
import type { ResolvedScheduleSpec } from "./scheduler-config.js";
import { createDelayFn, type DelayFn } from "./timing.js";

export type DispatchFn = (command: BaseCommand) => ResultAsync<unknown, Error>;

export type ScheduledJobDeps = {
	logger: Logger;
	dispatch: DispatchFn;
};

/** Outcome of a single dispatch attempt, as observed by the retry loop. */
export type DispatchOutcome = "success" | "overlapSkip" | "failure";

/** Per-job bookkeeping surfaced later by status and runtime commands. */
type JobRunState = {
	attemptCount: number;
	lastOutcome: DispatchOutcome | null;
	lastErrorMessage: string | null;
	nextFireAt: Date | null;
	stoppedWithError: boolean;
};

function initialRunState(): JobRunState {
	return {
		attemptCount: 0,
		lastOutcome: null,
		lastErrorMessage: null,
		nextFireAt: null,
		stoppedWithError: false,
	};
}

/**
 * Runs one job's chained-`setTimeout` lifecycle.
 *
 * Interval jobs anchor their next fire to the *completion* of the previous run, so
 * self-overlap is structurally impossible. Cron jobs are wall-clock anchored: the next
 * occurrence is scheduled the moment a tick fires, without waiting on that tick's dispatch —
 * a fire landing while the previous run is still in flight is left to the downstream
 * command's own guard, and rejection is treated as a skip rather than a failure.
 *
 * A real dispatch failure (anything but an overlap skip) starts its own backoff retry
 * loop in place of the normal cadence; the loop resets on any success. Overlap skips are
 * exempt from retry bookkeeping entirely — they don't touch the attempt count or backoff.
 */
export class ScheduledJob {
	private readonly _computeDelayMs: DelayFn;
	private readonly _isWallClockAnchored: boolean;
	private _timer: NodeJS.Timeout | null = null;
	private _stopped = true;
	private _skippedOverlapCount = 0;
	private _runState: JobRunState = initialRunState();

	constructor(
		private readonly _commandId: CommandId,
		private readonly _spec: ResolvedScheduleSpec,
		private readonly _deps: ScheduledJobDeps,
	) {
		this._isWallClockAnchored = this._spec.cron !== undefined;
		this._computeDelayMs = createDelayFn(this._spec);
	}

	/** Number of dispatches skipped because the command was already in progress. */
	get skippedOverlapCount(): number {
		return this._skippedOverlapCount;
	}

	/** Consecutive failures since the last success (or since start). Resets to 0 on success. */
	get attemptCount(): number {
		return this._runState.attemptCount;
	}

	/** Outcome of the most recently completed dispatch, or `null` before the first one. */
	get lastOutcome(): DispatchOutcome | null {
		return this._runState.lastOutcome;
	}

	/** Message of the most recent non-overlap failure. Cleared on success. */
	get lastErrorMessage(): string | null {
		return this._runState.lastErrorMessage;
	}

	/** When the job's next timer is due to fire, or `null` if none is scheduled. */
	get nextFireAt(): Date | null {
		return this._runState.nextFireAt;
	}

	/** True once an opt-in `maxAttempts` policy has exhausted and stopped the job. */
	get stoppedWithError(): boolean {
		return this._runState.stoppedWithError;
	}

	/** Schedules the job from `now`. No-op for `enabled: false` jobs. */
	start(): void {
		if (!this._spec.enabled) return;
		this._stopped = false;
		if (this._spec.runOnStart) {
			this.onTick(new Date());
		} else {
			this.scheduleNext(new Date());
		}
	}

	/** Cancels any pending timer. In-flight dispatches are left to finish on their own. */
	stop(): void {
		this._stopped = true;
		this.clearTimer();
	}

	private clearTimer(): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}

	private scheduleNext(from: Date): void {
		if (this._stopped || this._runState.stoppedWithError) return;
		this.clearTimer();
		const delayMs =
			this._runState.attemptCount > 0
				? computeRetryDelayMs(this._runState.attemptCount, this._spec.retry, this._spec.jitter)
				: this._computeDelayMs(from);
		this._runState.nextFireAt = new Date(from.getTime() + delayMs);
		this._timer = setTimeout(() => {
			this._timer = null;
			this.onTick(new Date());
		}, delayMs);
	}

	private onTick(referenceTime: Date): void {
		if (this._stopped) return;

		if (this._isWallClockAnchored) {
			// Cron never queues: the next occurrence is scheduled up front, alongside dispatch.
			this.scheduleNext(referenceTime);
			void this.dispatchAndObserve().then(({ completedAt, outcome, errorMessage }) =>
				this.handleOutcome(outcome, completedAt, errorMessage),
			);
			return;
		}

		void this.dispatchAndObserve().then(({ completedAt, outcome, errorMessage }) =>
			this.handleOutcome(outcome, completedAt, errorMessage),
		);
	}

	/**
	 * Applies a dispatch outcome to run state, then reschedules (or, on exhaustion,
	 * stops). For a wall-clock-anchored job whose attempt count didn't change (a healthy
	 * success, or an overlap skip at any point), the timer `onTick` already armed up
	 * front is still correct — replacing it here would re-anchor to completion time and
	 * undermine "cron never queues, in-flight overlap is a skip."
	 */
	private handleOutcome(
		outcome: DispatchOutcome,
		completedAt: Date,
		errorMessage: string | null,
	): void {
		const attemptCountBefore = this._runState.attemptCount;
		this._runState.lastOutcome = outcome;

		if (outcome === "success") {
			this.resetRunState();
		} else if (outcome === "failure") {
			this._runState.attemptCount += 1;
			this._runState.lastErrorMessage = errorMessage;
			const { retry } = this._spec;
			if (!retry.forever && this._runState.attemptCount >= retry.maxAttempts) {
				this.stopForExhaustion();
				return;
			}
		}

		const attemptCountChanged = this._runState.attemptCount !== attemptCountBefore;
		if (this._isWallClockAnchored && !attemptCountChanged) return;
		this.scheduleNext(completedAt);
	}

	private resetRunState(): void {
		this._runState.attemptCount = 0;
		this._runState.lastErrorMessage = null;
		this._runState.stoppedWithError = false;
	}

	private stopForExhaustion(): void {
		this._runState.stoppedWithError = true;
		this._runState.nextFireAt = null;
		this.clearTimer();
	}

	private dispatchAndObserve(): Promise<{
		completedAt: Date;
		outcome: DispatchOutcome;
		errorMessage: string | null;
	}> {
		return this._deps
			.dispatch(this._spec.command)
			.match(
				(): { outcome: DispatchOutcome; errorMessage: string | null } => ({
					outcome: "success",
					errorMessage: null,
				}),
				(error): { outcome: DispatchOutcome; errorMessage: string | null } => {
					if (isOverlapSkipError(error)) {
						this._skippedOverlapCount += 1;
						this._deps.logger.info(`Skipped ${this._commandId}: command already in progress`);
						return { outcome: "overlapSkip", errorMessage: null };
					}
					this._deps.logger.error(`${this._commandId} failed`, error);
					return { outcome: "failure", errorMessage: error.message };
				},
			)
			.then(({ outcome, errorMessage }) => ({ completedAt: new Date(), outcome, errorMessage }));
	}
}
