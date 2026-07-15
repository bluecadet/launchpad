import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { SchedulerError } from "./errors.js";
import { buildJobState, initialJobStatus, type JobStatus } from "./job-state.js";
import { isOverlapSkipError } from "./overlap.js";
import { RetryPolicy } from "./retry-policy.js";
import type { ResolvedScheduleSpec } from "./scheduler-config.js";
import type { SchedulerJobState } from "./scheduler-state.js";
import { createDelayFn, type DelayFn } from "./timing.js";

export type DispatchFn = (command: BaseCommand) => ResultAsync<unknown, Error>;

export type ScheduledJobDeps = {
	logger: Logger;
	dispatch: DispatchFn;
	onStateChange?: () => void;
};

/** Outcome of a single dispatch attempt, as observed by the retry loop. */
export type DispatchOutcome = "success" | "overlapSkip" | "failure";

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
	private readonly _retryPolicy: RetryPolicy;
	private _timer: NodeJS.Timeout | null = null;
	private _stopped = true;
	private _skippedOverlapCount = 0;
	private _status: JobStatus = initialJobStatus();
	private _inFlightDispatchCount = 0;

	constructor(
		private readonly _commandId: CommandId,
		private readonly _spec: ResolvedScheduleSpec,
		private readonly _deps: ScheduledJobDeps,
	) {
		this._isWallClockAnchored = this._spec.cron !== undefined;
		this._computeDelayMs = createDelayFn(this._spec);
		this._retryPolicy = new RetryPolicy(this._spec.retry, this._spec.jitter);
	}

	/** Number of dispatches skipped because the command was already in progress. */
	get skippedOverlapCount(): number {
		return this._skippedOverlapCount;
	}

	/** Consecutive failures since the last success (or since start). Resets to 0 on success. */
	get attemptCount(): number {
		return this._retryPolicy.attemptCount;
	}

	/** Outcome of the most recently completed dispatch, or `null` before the first one. */
	get lastOutcome(): DispatchOutcome | null {
		return this._status.lastOutcome;
	}

	/** Message of the most recent non-overlap failure. Cleared on success. */
	get lastErrorMessage(): string | null {
		return this._status.lastErrorMessage;
	}

	/** When the job's next timer is due to fire, or `null` if none is scheduled. */
	get nextFireAt(): Date | null {
		return this._status.nextFireAt;
	}

	/** True once an opt-in `maxAttempts` policy has exhausted and stopped the job. */
	get stoppedWithError(): boolean {
		return this._status.stoppedWithError;
	}

	/** True while this job has a dispatch in flight (a scheduled tick, retry, or manual trigger). */
	get isRunning(): boolean {
		return this._inFlightDispatchCount > 0;
	}

	/** A complete, serializable snapshot for controller-owned plugin state. */
	get state(): SchedulerJobState {
		return buildJobState({
			paused: this._stopped,
			spec: this._spec,
			status: this._status,
			attemptCount: this._retryPolicy.attemptCount,
			skippedOverlapCount: this._skippedOverlapCount,
			isRunning: this.isRunning,
		});
	}

	/** Schedules the job from `now`. */
	start(): void {
		this._stopped = false;
		this.notifyStateChange();
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
		this._status.nextFireAt = null;
		this.notifyStateChange();
	}

	/**
	 * Pauses future ticks (an alias of {@link stop}, kept as its own name for the
	 * `scheduler.pause` command's intent): cancels a pending retry or interval timer.
	 * An in-flight dispatch finishes naturally.
	 */
	pause(): void {
		this.stop();
	}

	/**
	 * Resumes a paused job from `now`. Backoff/attempt state does not survive a pause,
	 * so this also revives a job that had paused mid-backoff or after exhaustion.
	 */
	resume(): void {
		this._stopped = false;
		this.resetRunState();
		this.scheduleNext(new Date());
	}

	/**
	 * Fires the job immediately, re-anchoring the next tick from this dispatch's own
	 * completion rather than the normal cadence — this avoids a near-double-fire for
	 * cron jobs, which would otherwise still have a wall-clock occurrence pre-armed.
	 * Errors if a dispatch for this job is already in flight. Only exhaustion is
	 * revived (the spec'd case): a *paused* job still fires once, but stays paused
	 * afterward — `scheduleNext` is a no-op while `_stopped` is true, so triggering
	 * doesn't double as an implicit resume.
	 */
	trigger(): ResultAsync<unknown, Error> {
		if (this.isRunning) {
			return errAsync(new SchedulerError(`Job '${this._commandId}' is already running`));
		}

		this._status.stoppedWithError = false;
		this.clearTimer();
		this._status.nextFireAt = null;
		this.notifyStateChange();

		return ResultAsync.fromSafePromise(
			this.dispatchAndObserve().then(({ completedAt, outcome, errorMessage, error }) => {
				this.handleManualOutcome(outcome, completedAt, errorMessage);
				return outcome === "success"
					? ok(undefined)
					: err(error ?? new SchedulerError("Dispatch failed"));
			}),
		).andThen((result) => result);
	}

	private clearTimer(): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}

	private scheduleNext(from: Date): void {
		if (this._stopped || this._status.stoppedWithError) {
			this.notifyStateChange();
			return;
		}
		this.clearTimer();
		const delayMs = this._retryPolicy.isRetrying
			? this._retryPolicy.nextDelayMs()
			: this._computeDelayMs(from);
		this._status.nextFireAt = new Date(from.getTime() + delayMs);
		this._timer = setTimeout(() => {
			this._timer = null;
			this.onTick(new Date());
		}, delayMs);
		this.notifyStateChange();
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

		this._status.nextFireAt = null;
		this.notifyStateChange();
		void this.dispatchAndObserve().then(({ completedAt, outcome, errorMessage }) =>
			this.handleOutcome(outcome, completedAt, errorMessage),
		);
	}

	/** Applies a dispatch outcome to run state. Returns whether the job just exhausted. */
	private applyOutcome(
		outcome: DispatchOutcome,
		completedAt: Date,
		errorMessage: string | null,
	): boolean {
		this._status.lastOutcome = outcome;

		if (outcome === "success") {
			this.resetRunState();
			this._status.lastSuccessAt = completedAt;
			return false;
		}

		if (outcome === "failure") {
			this._status.lastErrorMessage = errorMessage;
			if (this._retryPolicy.recordFailure()) {
				this.stopForExhaustion();
				return true;
			}
		}

		return false;
	}

	/**
	 * Applies a scheduled tick's outcome, then reschedules (or, on exhaustion, stops).
	 * For a wall-clock-anchored job whose attempt count didn't change (a healthy
	 * success, or an overlap skip at any point), the timer `onTick` already armed up
	 * front is still correct — replacing it here would re-anchor to completion time and
	 * undermine "cron never queues, in-flight overlap is a skip."
	 */
	private handleOutcome(
		outcome: DispatchOutcome,
		completedAt: Date,
		errorMessage: string | null,
	): void {
		const attemptCountBefore = this._retryPolicy.attemptCount;
		if (this.applyOutcome(outcome, completedAt, errorMessage)) {
			this.notifyStateChange();
			return;
		}

		const attemptCountChanged = this._retryPolicy.attemptCount !== attemptCountBefore;
		if (this._isWallClockAnchored && !attemptCountChanged) {
			this.notifyStateChange();
			return;
		}
		this.scheduleNext(completedAt);
	}

	/**
	 * Applies a manually-triggered dispatch's outcome and always re-anchors the next
	 * tick from its completion — unlike {@link handleOutcome}, there's no pre-armed
	 * wall-clock timer to defer to, since {@link trigger} cancels it up front.
	 */
	private handleManualOutcome(
		outcome: DispatchOutcome,
		completedAt: Date,
		errorMessage: string | null,
	): void {
		if (this.applyOutcome(outcome, completedAt, errorMessage)) {
			this.notifyStateChange();
			return;
		}
		this.scheduleNext(completedAt);
	}

	private resetRunState(): void {
		this._retryPolicy.reset();
		this._status.lastErrorMessage = null;
		this._status.stoppedWithError = false;
	}

	private notifyStateChange(): void {
		this._deps.onStateChange?.();
	}

	private stopForExhaustion(): void {
		this._status.stoppedWithError = true;
		this._status.nextFireAt = null;
		this.clearTimer();
	}

	private dispatchAndObserve(): Promise<{
		completedAt: Date;
		outcome: DispatchOutcome;
		errorMessage: string | null;
		error: Error | null;
	}> {
		this._inFlightDispatchCount += 1;
		if (this._inFlightDispatchCount === 1) {
			this._status.runStartedAt = new Date();
		}
		this.notifyStateChange();
		return this._deps
			.dispatch(this._spec.command)
			.match(
				(): { outcome: DispatchOutcome; errorMessage: string | null; error: Error | null } => ({
					outcome: "success",
					errorMessage: null,
					error: null,
				}),
				(error): { outcome: DispatchOutcome; errorMessage: string | null; error: Error | null } => {
					if (isOverlapSkipError(error)) {
						this._skippedOverlapCount += 1;
						this._deps.logger.info(`Skipped ${this._commandId}: command already in progress`);
						return { outcome: "overlapSkip", errorMessage: null, error };
					}
					this._deps.logger.error(`${this._commandId} failed`, error);
					return { outcome: "failure", errorMessage: error.message, error };
				},
			)
			.then(({ outcome, errorMessage, error }) => {
				this._inFlightDispatchCount -= 1;
				if (this._inFlightDispatchCount === 0) {
					this._status.runStartedAt = null;
				}
				return { completedAt: new Date(), outcome, errorMessage, error };
			});
	}
}
