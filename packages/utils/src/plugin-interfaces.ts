import type { ResultAsync } from "neverthrow";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "./logger.js";
import type { PatchHandler, PatchHandlerWithVersion } from "./state-patcher.js";
import type { VersionedLaunchpadState } from "./types.js";

export type DisconnectReason =
	| { type: "manual" }
	| { type: "error"; error: Error }
	| { type: "signal"; signal: NodeJS.Signals };

/**
 * Optional interface for plugins that can be gracefully disconnected.
 * The controller will call disconnect() during shutdown if implemented.
 */
export interface Disconnectable {
	/**
	 * Gracefully disconnect this plugin.
	 * Should clean up resources, close connections, stop processes, etc.
	 */
	disconnect(reason: DisconnectReason): ResultAsync<void, Error>;
}

/**
 * Base command structure that all plugin commands must follow.
 * Plugins define their own specific command types that extend this.
 */
export type BaseCommand = {
	type: string;
	[key: string]: unknown;
};

/**
 * Optional interface for plugins that can execute commands.
 * When implemented, the controller will route commands to this method.
 * The plugin handles its own command routing internally.
 *
 * @template TCommand - The command type this plugin accepts (must extend BaseCommand)
 */
export interface CommandExecutor<TCommand extends BaseCommand = BaseCommand> {
	/**
	 * Execute a command on this plugin.
	 * @param command - Command object with type and parameters
	 * @returns Result of command execution
	 */
	executeCommand(command: TCommand): ResultAsync<unknown, Error>;
}

/**
 * Optional interface for plugins that provide queryable state.
 * When implemented, the controller can aggregate state from all plugins.
 *
 * @template TState - The state type this plugin provides
 */
export interface StateProvider<TState = unknown> {
	/**
	 * Get the current (immutable) state of this plugin.
	 * This should be a lightweight, synchronous operation.
	 * @returns Current state snapshot
	 */
	getState(): TState;

	/**
	 * Subscribe to state patches/updates.
	 * @param handler - Function called with an array of state patches
	 * @return Unsubscribe function
	 */
	onStatePatch(handler: PatchHandler): () => void;
}

export interface PluginContext {
	readonly eventBus: EventBus;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;
	readonly cwd: string;
	readonly dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	readonly getState: () => VersionedLaunchpadState;
	readonly onStatePatch: (handler: PatchHandlerWithVersion) => () => void;
}

/**
 * Generic plugin type that can optionally implement any controller interfaces.
 *
 * @template TCommand - The command type this plugin accepts (must extend BaseCommand)
 * @template TState - The state type this plugin provides
 */
export type InstantiatedPlugin<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
> = Partial<Disconnectable & CommandExecutor<TCommand> & StateProvider<TState>>;

/**
 * Interface for plugins that require async setup/initialization.
 * Factories implement this interface to provide a formalized setup flow.
 *
 * @template TCommand - The command type this plugin accepts
 * @template TState - The state type this plugin provides
 * @template E - The error type returned on setup failure
 * @template TPlugin - The actual plugin type returned
 */
export interface PluginConfig<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
	E = Error,
	TPlugin extends InstantiatedPlugin<TCommand, TState> = InstantiatedPlugin<TCommand, TState>,
> {
	/**
	 * Unique name of the plugin.
	 */
	name: string;
	/**
	 * Optional commands to dispatch after this plugin is registered during startup.
	 * The controller will dispatch these in order after all plugins are registered.
	 */
	startupCommands?: BaseCommand[];
	/**
	 * Initialize a plugin instance with the provided context.
	 * This is called once during plugin registration.
	 *
	 * @param ctx Plugin context (logger, eventBus, cwd)
	 * @returns Configured plugin instance that conforms to standard interfaces
	 */
	setup(ctx: PluginContext): ResultAsync<TPlugin, E>;
}

// Helper that validates conformance while preserving concrete type
export function definePlugin<
	TCommand extends BaseCommand,
	TState,
	E,
	TPlugin extends InstantiatedPlugin<TCommand, TState>,
>(factory: PluginConfig<TCommand, TState, E, TPlugin>): PluginConfig<TCommand, TState, E, TPlugin> {
	return factory;
}
