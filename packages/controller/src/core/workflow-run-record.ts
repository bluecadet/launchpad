import type { WorkflowRun, WorkflowStepResult } from "./workflow-state.js";

/** A step the run never attempted, recorded as skipped when the run finishes. */
export type UnattemptedStep = {
	index: number;
	command: string;
};

/**
 * Builds the {@link WorkflowRun} record for one run, one transition at a time.
 *
 * Every method returns a **fresh** object. Records are handed to an Immer
 * producer, which freezes them; mutating a previously emitted record would
 * throw on the next write.
 *
 * Failures are recorded as `error.message` only — never the thrown value, never
 * `cause`, never a command's return value. A workflow step can dispatch a
 * command whose result carries data that must not enter state or the wire.
 */
export class WorkflowRunRecorder {
	private _steps: WorkflowStepResult[] = [];
	private _startedAtMs: number;

	constructor(
		private readonly _runId: number,
		private readonly _name: string,
		private readonly _stepCount: number,
		private readonly _now: () => number = Date.now,
	) {
		this._startedAtMs = this._now();
	}

	/** Current wall clock, for a caller timing an individual step. */
	now(): number {
		return this._now();
	}

	start(): WorkflowRun {
		this._startedAtMs = this._now();
		return this._snapshot({
			status: "running",
			finishedAt: null,
			durationMs: null,
			error: null,
		});
	}

	stepFinished(
		index: number,
		command: string,
		startedAtMs: number,
		error: Error | null,
	): WorkflowRun {
		this._steps.push({
			index,
			command,
			status: error ? "error" : "success",
			durationMs: Math.max(0, this._now() - startedAtMs),
			error: error ? error.message : null,
		});
		return this._snapshot({
			status: "running",
			finishedAt: null,
			durationMs: null,
			error: null,
		});
	}

	finish(unattempted: readonly UnattemptedStep[], aggregateError: Error | null): WorkflowRun {
		for (const step of unattempted) {
			this._steps.push({
				index: step.index,
				command: step.command,
				status: "skipped",
				durationMs: 0,
				error: null,
			});
		}

		const finishedAtMs = this._now();
		return this._snapshot({
			status: aggregateError ? "error" : "success",
			finishedAt: new Date(finishedAtMs).toISOString(),
			durationMs: Math.max(0, finishedAtMs - this._startedAtMs),
			error: aggregateError ? aggregateError.message : null,
		});
	}

	private _snapshot(
		fields: Pick<WorkflowRun, "status" | "finishedAt" | "durationMs" | "error">,
	): WorkflowRun {
		return {
			runId: this._runId,
			name: this._name,
			startedAt: new Date(this._startedAtMs).toISOString(),
			stepCount: this._stepCount,
			steps: this._steps.map((step) => ({ ...step })),
			...fields,
		};
	}
}
