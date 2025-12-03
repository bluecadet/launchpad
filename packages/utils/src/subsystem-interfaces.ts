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
 * Optional interface for subsystems that can be gracefully disconnected.
 * The controller will call disconnect() during shutdown if implemented.
 */
export interface Disconnectable {
	/**
	 * Gracefully disconnect this subsystem.
	 * Should clean up resources, close connections, stop processes, etc.
	 */
	disconnect(reason: DisconnectReason): ResultAsync<void, Error>;
}

/**
 * Base command structure that all subsystem commands must follow.
 * Subsystems define their own specific command types that extend this.
 */
export type BaseCommand = {
	type: string;
	[key: string]: unknown;
};

/**
 * Optional interface for subsystems that can execute commands.
 * When implemented, the controller will route commands to this method.
 * The subsystem handles its own command routing internally.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 */
export interface CommandExecutor<TCommand extends BaseCommand = BaseCommand> {
	/**
	 * Execute a command on this subsystem.
	 * @param command - Command object with type and parameters
	 * @returns Result of command execution
	 */
	executeCommand(command: TCommand): ResultAsync<unknown, Error>;
}

/**
 * Optional interface for subsystems that provide queryable state.
 * When implemented, the controller can aggregate state from all subsystems.
 *
 * @template TState - The state type this subsystem provides
 */
export interface StateProvider<TState = unknown> {
	/**
	 * Get the current (immutable) state of this subsystem.
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

export interface SubsystemContext {
	readonly eventBus: EventBus;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;
	readonly cwd: string;
	readonly dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	readonly getState: () => VersionedLaunchpadState;
	readonly onStatePatch: (handler: PatchHandlerWithVersion) => () => void;
}

/**
 * Generic subsystem type that can optionally implement any controller interfaces.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 * @template TState - The state type this subsystem provides
 */
export type InstantiatedSubsystem<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
> = Partial<Disconnectable & CommandExecutor<TCommand> & StateProvider<TState>>;

/**
 * Interface for subsystems that require async setup/initialization.
 * Factories implement this interface to provide a formalized setup flow.
 *
 * @template TCommand - The command type this subsystem accepts
 * @template TState - The state type this subsystem provides
 * @template E - The error type returned on setup failure
 * @template TSubsystem - The actual subsystem type returned
 */
export interface SubsystemConfig<
	TCommand extends BaseCommand = BaseCommand,
	TState = unknown,
	E = Error,
	TSubsystem extends InstantiatedSubsystem<TCommand, TState> = InstantiatedSubsystem<
		TCommand,
		TState
	>,
> {
	/**
	 * Unique name of the subsystem.
	 */
	name: string;
	/**
	 * Initialize a subsystem instance with the provided context.
	 * This is called once during subsystem registration.
	 *
	 * @param ctx Subsystem context (logger, eventBus, cwd)
	 * @returns Configured subsystem instance that conforms to standard interfaces
	 */
	setup(ctx: SubsystemContext): ResultAsync<TSubsystem, E>;
}

// Helper that validates conformance while preserving concrete type
export function defineSubsystem<
	TCommand extends BaseCommand,
	TState,
	E,
	TSubsystem extends InstantiatedSubsystem<TCommand, TState>,
>(
	factory: SubsystemConfig<TCommand, TState, E, TSubsystem>,
): SubsystemConfig<TCommand, TState, E, TSubsystem> {
	return factory;
}
