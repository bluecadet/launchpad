import type { ResultAsync } from "neverthrow";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "./logger.js";
import type { PatchHandler } from "./state-patcher.js";
/**
 * Optional interface for subsystems that can be gracefully disconnected.
 * The controller will call disconnect() during shutdown if implemented.
 */
export interface Disconnectable {
	/**
	 * Gracefully disconnect this subsystem.
	 * Should clean up resources, close connections, stop processes, etc.
	 */
	disconnect(): ResultAsync<void, Error>;
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
	readonly cwd: string;
}

/**
 * Generic subsystem type that can optionally implement any controller interfaces.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 * @template TState - The state type this subsystem provides
 */
export type Subsystem<TCommand extends BaseCommand = BaseCommand, TState = unknown> = Partial<
	Disconnectable & CommandExecutor<TCommand> & StateProvider<TState>
>;
