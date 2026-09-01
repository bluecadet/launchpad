import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { WorkflowError } from "../errors.js";
import { type UnattemptedStep, WorkflowRunRecorder } from "./workflow-run-record.js";
import type { WorkflowRun, WorkflowSummary } from "./workflow-state.js";
import { resolveWorkflowStep, type WorkflowMap, type WorkflowStep } from "./workflow-types.js";

export type WorkflowObserver = {
	/** The configured set changed — `setWorkflows()` ran. */
	workflowsChanged(summaries: readonly WorkflowSummary[]): void;
	/** A run started, advanced a step, or finished. */
	runUpdated(run: WorkflowRun): void;
};

/**
 * The narrow surface the `workflows` plugin drives. Structural on purpose: the
 * plugin depends on this, not on {@link WorkflowRunner} or the controller.
 */
export type WorkflowHost = {
	list(): WorkflowSummary[];
	has(name: string): boolean;
	run(name: string): ResultAsync<void, Error>;
	subscribe(observer: WorkflowObserver): () => void;
};

export class WorkflowRunner implements WorkflowHost {
	private _workflows: WorkflowMap = {};
	private _observers: WorkflowObserver[] = [];
	private _inFlight = new Set<string>();
	private _nextRunId = 1;

	constructor(
		private _eventBus: EventBus,
		private _executeCommand: (command: BaseCommand) => ResultAsync<unknown, Error>,
	) {}

	setWorkflows(workflows: WorkflowMap): void {
		this._workflows = workflows;
		const summaries = this.list();
		this._notify((observer) => observer.workflowsChanged(summaries));
	}

	list(): WorkflowSummary[] {
		return Object.entries(this._workflows).flatMap(([name, steps]) =>
			steps && steps.length > 0 ? [{ name, stepCount: steps.length }] : [],
		);
	}

	has(name: string): boolean {
		const steps = this._workflows[name];
		return steps !== undefined && steps.length > 0;
	}

	subscribe(observer: WorkflowObserver): () => void {
		this._observers.push(observer);
		return () => {
			const index = this._observers.indexOf(observer);
			if (index > -1) {
				this._observers.splice(index, 1);
			}
		};
	}

	run(name: string): ResultAsync<void, Error> {
		const steps = this._workflows[name];
		if (!steps || steps.length === 0) {
			return okAsync(undefined);
		}

		// A workflow step can itself be `workflow.run`, so an operator can write a
		// self-referential or cyclic recipe. Rejecting a re-entrant run keeps that
		// from recursing until the daemon runs out of stack, and keeps two
		// concurrent runs from fighting over one `runs[name]` slot.
		if (this._inFlight.has(name)) {
			return errAsync(new WorkflowError(`Workflow '${name}' is already running`));
		}
		this._inFlight.add(name);

		const recorder = new WorkflowRunRecorder(this._nextRunId++, name, steps.length);
		this._notify((observer) => observer.runUpdated(recorder.start()));
		this._eventBus.emit("workflow:start", { name, stepCount: steps.length });

		return ResultAsync.fromSafePromise(this._runSteps(name, steps, recorder)).andThen(
			({ errors, attemptedCount }) => {
				this._inFlight.delete(name);
				const unattempted = unattemptedSteps(steps, attemptedCount);
				const error = errors.length > 0 ? aggregateWorkflowErrors(name, errors) : null;

				// Observers are notified before the events and before this chain
				// settles, so a caller reading the record back sees the finished run.
				this._notify((observer) => observer.runUpdated(recorder.finish(unattempted, error)));

				if (error) {
					this._eventBus.emit("workflow:error", { name, stepCount: steps.length, error });
					return errAsync(error);
				}

				this._eventBus.emit("workflow:success", { name, stepCount: steps.length });
				return okAsync(undefined);
			},
		);
	}

	private _notify(notify: (observer: WorkflowObserver) => void): void {
		for (const observer of [...this._observers]) {
			notify(observer);
		}
	}

	private async _runSteps(
		name: string,
		steps: readonly WorkflowStep[],
		recorder: WorkflowRunRecorder,
	): Promise<{ errors: Error[]; attemptedCount: number }> {
		const errors: Error[] = [];
		let attemptedCount = 0;

		for (const [index, step] of steps.entries()) {
			const { command, stopOnError } = resolveWorkflowStep(step);
			const startedAtMs = recorder.now();
			const result = await this._executeStep(name, index, command);
			attemptedCount = index + 1;

			const stepError = result.isErr() ? result.error : null;
			this._notify((observer) =>
				observer.runUpdated(recorder.stepFinished(index, command.type, startedAtMs, stepError)),
			);

			if (stepError) {
				errors.push(stepError);
				if (stopOnError) {
					break;
				}
			}
		}

		return { errors, attemptedCount };
	}

	private _executeStep(
		name: string,
		index: number,
		command: BaseCommand,
	): ResultAsync<void, Error> {
		this._eventBus.emit("workflow:step:start", {
			name,
			stepIndex: index,
			command,
		});

		return this._executeCommand(command)
			.map(() => {
				this._eventBus.emit("workflow:step:success", {
					name,
					stepIndex: index,
					command,
				});
				return undefined;
			})
			.mapErr((error) => {
				this._eventBus.emit("workflow:step:error", {
					name,
					stepIndex: index,
					command,
					error,
				});
				return error;
			});
	}
}

function unattemptedSteps(
	steps: readonly WorkflowStep[],
	attemptedCount: number,
): UnattemptedStep[] {
	return steps.slice(attemptedCount).map((step, offset) => ({
		index: attemptedCount + offset,
		command: resolveWorkflowStep(step).command.type,
	}));
}

function aggregateWorkflowErrors(name: string, errors: Error[]): Error {
	const [first] = errors;
	if (first && errors.length === 1) {
		return first;
	}
	return new AggregateError(
		errors,
		`Workflow "${name}" completed with ${errors.length} step failures`,
	);
}
