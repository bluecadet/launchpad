import type { BaseCommand, Subsystem } from "@bluecadet/launchpad-utils";
import { errAsync, type ResultAsync } from "neverthrow";
import type { EventBus } from "./event-bus.js";

/**
 * CommandDispatcher routes commands to appropriate subsystems and emits events.
 *
 * The dispatcher is generic - it doesn't know about specific command types.
 * Each subsystem implements CommandExecutor<TCommand> with its own command type,
 * providing full type safety at the subsystem level.
 *
 * Flow:
 * 1. Extracts subsystem name from command.type
 * 2. Checks if subsystem is registered
 * 3. Checks if subsystem implements CommandExecutor
 * 4. Emits "command:start" event
 * 5. Delegates to subsystem.executeCommand() (subsystem has type safety)
 * 6. Emits "command:success" or "command:error" event
 * 7. Returns result
 */
export class CommandDispatcher {
	constructor(
		private _eventBus: EventBus,
		private _subsystems: Map<string, Subsystem>,
	) {}

	/**
	 * Dispatch a command to the appropriate subsystem.
	 * The command is treated generically here - type safety is enforced at the subsystem level.
	 */
	dispatch(command: BaseCommand): ResultAsync<unknown, Error> {
		// 1. Extract subsystem name from command type (e.g., "content.fetch" -> "content")
		const subsystemName = command.type.split(".")[0];
		if (!subsystemName) {
			const error = new Error(`Invalid command type: ${command.type}`);
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		const subsystem = this._subsystems.get(subsystemName);

		// 2. Check if subsystem is registered
		if (!subsystem) {
			const error = new Error(
				`Subsystem '${subsystemName}' not available. ` +
					`Install @bluecadet/launchpad-${subsystemName} to use this command.`,
			);
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		// 3. Check if subsystem implements CommandExecutor
		if (!subsystem.executeCommand) {
			const error = new Error(
				`Subsystem '${subsystemName}' does not support command execution. ` +
					"The subsystem must implement the CommandExecutor interface.",
			);
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		// 4. Emit "before" event
		this._eventBus.emit("command:start", { commandType: command.type, ...command });

		// 5. Delegate to subsystem's executeCommand method
		// The subsystem receives the command with its specific type and enforces type safety
		const result = subsystem.executeCommand(command);

		// 6. Emit "after" event based on result
		result.match(
			(value) => {
				this._eventBus.emit("command:success", {
					commandType: command.type,
					result: value,
				});
			},
			(error) => {
				this._eventBus.emit("command:error", {
					commandType: command.type,
					error,
				});
			},
		);

		return result;
	}
}
