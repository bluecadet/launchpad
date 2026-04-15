import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, type ResultAsync } from "neverthrow";
import { CommandExecutionError } from "../errors.js";
import type { CommandRegistry } from "./command-registry.js";

/** Core controller event types for use with generic EventBus. */
export type CoreEvents = {
	"command:start": { commandType: string; [key: string]: unknown };
	"command:success": { commandType: string; result?: unknown };
	"command:error": { commandType: string; error: Error };
	"system:shutdown": { code?: number; signal?: string };
	"system:error": { error: Error; context?: string };
};

/**
 * Core controller events.
 * Plugins can augment this interface via declaration merging
 *
 */
declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents extends CoreEvents {}
}

/**
 * CommandDispatcher routes commands through the explicit controller-owned registry
 * and emits command lifecycle events.
 */
export class CommandDispatcher {
	constructor(
		private _eventBus: EventBus,
		private _commandRegistry: CommandRegistry,
	) {}

	dispatch(command: BaseCommand): ResultAsync<unknown, CommandExecutionError> {
		const registered = this._commandRegistry.resolve(command.type);
		if (!registered) {
			const error = new CommandExecutionError(`Command '${command.type}' is not registered`, {
				commandType: command.type,
			});
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		const canonicalCommand = this._commandRegistry.canonicalizeCommand(
			command,
			registered.descriptor,
		);
		const parsed = this._commandRegistry.parseCommand(
			registered.descriptor.parser,
			canonicalCommand,
		);
		if (parsed.isErr()) {
			this._eventBus.emit("command:error", {
				commandType: canonicalCommand.type,
				error: parsed.error,
			});
			return errAsync(parsed.error);
		}

		return this.executeWithEvents(parsed.value, () => registered.execute(parsed.value));
	}

	private executeWithEvents(
		command: BaseCommand,
		execute: () => ResultAsync<unknown, Error>,
	): ResultAsync<unknown, CommandExecutionError> {
		this._eventBus.emit("command:start", { commandType: command.type, ...command });

		const result = execute();

		result.match(
			(value) => {
				this._eventBus.emit("command:success", {
					commandType: command.type,
					result: value,
				});
			},
			(error) => {
				const wrappedError =
					error instanceof CommandExecutionError
						? error
						: new CommandExecutionError("Plugin command execution failed", {
								cause: ensureError(error),
								commandType: command.type,
							});
				this._eventBus.emit("command:error", {
					commandType: command.type,
					error: wrappedError,
				});
			},
		);

		return result.mapErr((error) =>
			error instanceof CommandExecutionError
				? error
				: new CommandExecutionError("Plugin command execution failed", {
						cause: ensureError(error),
						commandType: command.type,
					}),
		);
	}
}
