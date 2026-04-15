import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { okAsync, type ResultAsync } from "neverthrow";
import { resolveWorkflowStep, type WorkflowMap } from "./workflow-types.js";

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

		let chain: ResultAsync<void, Error> = okAsync(undefined);
		for (const [index, step] of steps.entries()) {
			const command = resolveWorkflowStep(step);
			chain = chain.andThen(() => this._executeStep(name, index, command));
		}

		return chain
			.map(() => {
				this._eventBus.emit("workflow:success", { name, stepCount: steps.length });
				return undefined;
			})
			.mapErr((error: Error) => {
				this._eventBus.emit("workflow:error", {
					name,
					stepCount: steps.length,
					error,
				});
				return error;
			});
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
