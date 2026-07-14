import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { ResultAsync } from "neverthrow";
import { isOverlapSkipError } from "./overlap.js";
import type { ResolvedScheduleSpec } from "./scheduler-config.js";
import { createDelayFn, type DelayFn } from "./timing.js";

export type DispatchFn = (command: BaseCommand) => ResultAsync<unknown, Error>;

export type ScheduledJobDeps = {
	logger: Logger;
	dispatch: DispatchFn;
};

/**
 * Runs one job's chained-`setTimeout` lifecycle.
 *
 * Interval jobs anchor their next fire to the *completion* of the previous run, so
 * self-overlap is structurally impossible. Cron jobs are wall-clock anchored: the next
 * occurrence is scheduled the moment a tick fires, without waiting on that tick's dispatch —
 * a fire landing while the previous run is still in flight is left to the downstream
 * command's own guard, and rejection is treated as a skip rather than a failure.
 */
export class ScheduledJob {
	private readonly _computeDelayMs: DelayFn;
	private readonly _isWallClockAnchored: boolean;
	private _timer: NodeJS.Timeout | null = null;
	private _stopped = true;
	private _skippedOverlapCount = 0;

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
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	}

	private scheduleNext(from: Date): void {
		if (this._stopped) return;
		const delayMs = this._computeDelayMs(from);
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
			void this.dispatchAndObserve();
			return;
		}

		void this.dispatchAndObserve().then((completedAt) => {
			this.scheduleNext(completedAt);
		});
	}

	private dispatchAndObserve(): Promise<Date> {
		return this._deps
			.dispatch(this._spec.command)
			.match(
				() => undefined,
				(error) => {
					if (isOverlapSkipError(error)) {
						this._skippedOverlapCount += 1;
						this._deps.logger.info(`Skipped ${this._commandId}: command already in progress`);
					} else {
						this._deps.logger.error(`${this._commandId} failed`, error);
					}
				},
			)
			.then(() => new Date());
	}
}
