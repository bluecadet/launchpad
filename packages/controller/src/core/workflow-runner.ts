import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { resolveWorkflowStep, type WorkflowMap, type WorkflowStep } from "./workflow-types.js";

export class WorkflowRunner {
	private _workflows: WorkflowMap = {};

	constructor(
		private _eventBus: EventBus,
		private _executeCommand: (command: BaseCommand) => ResultAsync<unknown, Error>,
	) {}

	setWorkflows(workflows: WorkflowMap): void {
		this._workflows = workflows;
	}

	run(name: string): ResultAsync<void, Error> {
		const steps = this._workflows[name];
		if (!steps || steps.length === 0) {
			return okAsync(undefined);
		}

		this._eventBus.emit("workflow:start", { name, stepCount: steps.length });

		return ResultAsync.fromSafePromise(this._runSteps(name, steps)).andThen((errors) => {
			if (errors.length > 0) {
				const error = aggregateWorkflowErrors(name, errors);
				this._eventBus.emit("workflow:error", { name, stepCount: steps.length, error });
				return errAsync(error);
			}

			this._eventBus.emit("workflow:success", { name, stepCount: steps.length });
			return okAsync(undefined);
		});
	}

	private async _runSteps(name: string, steps: readonly WorkflowStep[]): Promise<Error[]> {
		const errors: Error[] = [];
		for (const [index, step] of steps.entries()) {
			const { command, stopOnError } = resolveWorkflowStep(step);
			const result = await this._executeStep(name, index, command);
			if (result.isErr()) {
				errors.push(result.error);
				if (stopOnError) {
					break;
				}
			}
		}
		return errors;
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
