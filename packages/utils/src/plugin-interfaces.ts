/**
 * Plugin system contracts.
 *
 * The architecture follows a two-sided contract:
 *
 * **Plugin properties** = capabilities the plugin OFFERS to the controller.
 *   - `CommandExecutor` — plugin can receive and process commands
 *   - `Disconnectable` — plugin can perform graceful resource cleanup
 *
 * **PluginContext** = infrastructure the controller PROVIDES to the plugin.
 *   - Communication: `eventBus`, `dispatchCommand`
 *   - Environment: `logger`, `cwd`
 *   - Lifecycle: `abortSignal`
 *   - State: `updateState` (write this plugin's slice), `getGlobalState` (read the whole system)
 *
 * State management is controller-owned: plugins call `ctx.updateState()` at the top of `setup()`
 * to establish their initial state, and the controller lazily creates the underlying state store
 * on first call. The controller owns patch generation, versioning, and broadcasting.
 *
 * ## Error handling contract
 *
 * - Plugin methods **must** return `Result` / `ResultAsync` — never throw.
 *   Thrown exceptions are considered bugs and will be logged as unhandled errors.
 * - Library packages **must not** call `process.exit()`. Only the CLI entry
 *   point (or the host application) may terminate the process.
 * - Use `errAsync()` / `err()` from neverthrow for all error return paths.
 */
import type { ResultAsync } from "neverthrow";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "./logger.js";
import type { DashboardRegistry } from "./panel-registry.js";
import type { PatchHandler, PatchHandlerWithVersion } from "./state-patcher.js";
import type { StatusRegistry } from "./status-registry.js";
import type { VersionedLaunchpadState } from "./types.js";

export type DisconnectReason =
	| { type: "manual" }
	| { type: "error"; error: Error }
	| { type: "signal"; signal: NodeJS.Signals };

/**
 * Optional interface for plugins that need explicit resource teardown.
 * The controller calls disconnect() during shutdown AFTER aborting the AbortSignal,
 * so in-flight async operations are already cancelled by the time disconnect() runs.
 *
 * Use `Disconnectable` when the plugin manages long-lived resources (connections,
 * child processes) that require deliberate cleanup. Plugins that only perform
 * HTTP requests or file I/O can rely solely on `abortSignal` cancellation.
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
 *
 * Prefer pairing each plugin-specific command union with a Zod schema and
 * validating incoming payloads inside `executeCommand()` so malformed runtime
 * input is rejected at the plugin boundary.
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

export interface PluginContext<TState = unknown> {
	readonly eventBus: EventBus;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;
	readonly cwd: string;
	readonly dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	/** Read the full aggregated system state (all plugins + system). Use sparingly — prefer eventBus or dispatchCommand for cross-plugin communication. */
	readonly getGlobalState: () => VersionedLaunchpadState;
	readonly onGlobalStatePatch: (handler: PatchHandlerWithVersion) => () => void;
	/**
	 * Update this plugin's state slice.
	 *
	 * Call this at the top of `setup()` with a complete initial value (returning the state object
	 * directly) to establish state. For subsequent updates, use a standard Immer producer that
	 * mutates the draft. The controller lazily creates the state manager on first call.
	 */
	readonly updateState: (producer: (draft: TState) => void) => void;
	/** Dashboard contribution registry for registering panels, pages, scripts, styles, and routes. */
	readonly dashboardRegistry: DashboardRegistry;
	/** Status section registry for contributing CLI status renderers. */
	readonly statusRegistry: StatusRegistry;
}

/**
 * Generic plugin type that can optionally implement any controller interfaces.
 *
 * @template TCommand - The command type this plugin accepts (must extend BaseCommand)
 */
export type InstantiatedPlugin<TCommand extends BaseCommand = BaseCommand> = Partial<
	Disconnectable & CommandExecutor<TCommand>
>;

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
	TPlugin extends InstantiatedPlugin<TCommand> = InstantiatedPlugin<TCommand>,
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
	setup(ctx: PluginContext<TState>): ResultAsync<TPlugin, E>;
}

// Helper that validates conformance while preserving concrete type
export function definePlugin<
	TCommand extends BaseCommand,
	TState,
	E,
	TPlugin extends InstantiatedPlugin<TCommand>,
>(factory: PluginConfig<TCommand, TState, E, TPlugin>): PluginConfig<TCommand, TState, E, TPlugin> {
	return factory;
}
