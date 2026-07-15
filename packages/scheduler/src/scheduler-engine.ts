import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "neverthrow";
import { SchedulerError } from "./errors.js";
import { ScheduledJob, type ScheduledJobDeps } from "./scheduled-job.js";
import type { ResolvedSchedulerConfig } from "./scheduler-config.js";
import type { SchedulerState } from "./scheduler-state.js";

/** Owns the set of scheduled jobs built from a resolved scheduler config. */
export class SchedulerEngine {
	private readonly _jobs = new Map<CommandId, ScheduledJob>();

	constructor(
		config: ResolvedSchedulerConfig,
		deps: ScheduledJobDeps,
		private readonly onStateChange?: (state: SchedulerState) => void,
	) {
		for (const [rawCommandId, spec] of Object.entries(config)) {
			if (!spec?.enabled) continue;
			const commandId = rawCommandId as CommandId;
			this._jobs.set(
				commandId,
				new ScheduledJob(commandId, spec, {
					...deps,
					onStateChange: () => this.publishState(),
				}),
			);
		}
	}

	/** Complete scheduler state for the controller-owned plugin snapshot. */
	get state(): SchedulerState {
		const jobs: SchedulerState["jobs"] = {};
		for (const [commandId, job] of this._jobs) {
			jobs[commandId] = job.state;
		}
		return { jobs };
	}

	/** Starts every configured job from `now`. */
	start(): void {
		for (const job of this._jobs.values()) {
			job.start();
		}
		this.publishState();
	}

	/** Cancels every job's pending timer. */
	stop(): void {
		for (const job of this._jobs.values()) {
			job.stop();
		}
	}

	/** Pauses the named job, or every job when `job` is omitted. Errors on an unknown job name. */
	pause(job?: CommandId): ResultAsync<void, SchedulerError> {
		return this.applyToScope(job, (j) => j.pause());
	}

	/** Resumes the named job, or every job when `job` is omitted. Errors on an unknown job name. */
	resume(job?: CommandId): ResultAsync<void, SchedulerError> {
		return this.applyToScope(job, (j) => j.resume());
	}

	/** Fires the named job immediately. Errors on an unknown job name or a job already running. */
	trigger(job: CommandId): ResultAsync<unknown, Error> {
		const resolved = this.resolveJob(job);
		if (resolved.isErr()) return errAsync(resolved.error);
		return resolved.value.trigger();
	}

	/** Runs `action` on the named job, or every job when `scope` is omitted. */
	private applyToScope(
		scope: CommandId | undefined,
		action: (job: ScheduledJob) => void,
	): ResultAsync<void, SchedulerError> {
		if (scope === undefined) {
			for (const job of this._jobs.values()) action(job);
			return okAsync(undefined);
		}

		const resolved = this.resolveJob(scope);
		if (resolved.isErr()) return errAsync(resolved.error);
		action(resolved.value);
		return okAsync(undefined);
	}

	private resolveJob(job: CommandId): Result<ScheduledJob, SchedulerError> {
		const found = this._jobs.get(job);
		if (!found) return err(new SchedulerError(`Unknown scheduler job '${job}'`));
		return ok(found);
	}

	private publishState(): void {
		this.onStateChange?.(this.state);
	}
}
