import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand, InstantiatedPlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, type ResultAsync } from "neverthrow";
import { CommandExecutionError } from "../errors.js";

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
 * CommandDispatcher routes commands to appropriate plugins and emits events.
 *
 * The dispatcher is generic - it doesn't know about specific command types.
 * Each plugin implements CommandExecutor<TCommand> with its own command type,
 * providing full type safety at the plugin level.
 *
 * Flow:
 * 1. Extracts plugin name from command.type
 * 2. Checks if plugin is registered
 * 3. Checks if plugin implements CommandExecutor
 * 4. Emits "command:start" event
 * 5. Delegates to plugin.executeCommand() (plugin has type safety)
 * 6. Emits "command:success" or "command:error" event
 * 7. Returns result
 */
export class CommandDispatcher {
	constructor(
		private _eventBus: EventBus,
		private _plugins: Map<string, InstantiatedPlugin>,
	) {}

	/**
	 * Dispatch a command to the appropriate plugin.
	 * The command is treated generically here - type safety is enforced at the plugin level.
	 */
	dispatch(command: BaseCommand): ResultAsync<unknown, CommandExecutionError> {
		// 1. Extract plugin name from command type (e.g., "content.fetch" -> "content")
		const pluginName = command.type.split(".")[0];
		if (!pluginName) {
			const error = new CommandExecutionError(`Invalid command type: ${command.type}`, {
				commandType: command.type,
			});
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		const plugin = this._plugins.get(pluginName);

		// 2. Check if plugin is registered
		if (!plugin) {
			const error = new CommandExecutionError(
				`Plugin '${pluginName}' not available. Install @bluecadet/launchpad-${pluginName} to use this command.`,
				{ commandType: command.type },
			);
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		// 3. Check if plugin implements CommandExecutor
		if (!plugin.executeCommand) {
			const error = new CommandExecutionError(
				`Plugin '${pluginName}' does not support command execution. The plugin must implement the CommandExecutor interface.`,
				{ commandType: command.type },
			);
			this._eventBus.emit("command:error", { commandType: command.type, error });
			return errAsync(error);
		}

		// 4. Emit "before" event
		this._eventBus.emit("command:start", { commandType: command.type, ...command });

		// 5. Delegate to plugin's executeCommand method
		// The plugin receives the command with its specific type and enforces type safety
		const result = plugin.executeCommand(command);

		// 6. Emit "after" event based on result and wrap any plugin errors
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

		// Return result with type-safe error (plugin may return generic Error, we map it)
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
