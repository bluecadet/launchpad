import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { ScheduledJob, type ScheduledJobDeps } from "./scheduled-job.js";
import type { ResolvedSchedulerConfig } from "./scheduler-config.js";

/** Owns the set of scheduled jobs built from a resolved scheduler config. */
export class SchedulerEngine {
	private readonly _jobs = new Map<CommandId, ScheduledJob>();

	constructor(config: ResolvedSchedulerConfig, deps: ScheduledJobDeps) {
		for (const [rawCommandId, spec] of Object.entries(config)) {
			if (!spec) continue;
			const commandId = rawCommandId as CommandId;
			this._jobs.set(commandId, new ScheduledJob(commandId, spec, deps));
		}
	}

	/** Starts every configured job from `now`. */
	start(): void {
		for (const job of this._jobs.values()) {
			job.start();
		}
	}

	/** Cancels every job's pending timer. */
	stop(): void {
		for (const job of this._jobs.values()) {
			job.stop();
		}
	}
}
