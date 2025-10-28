import type { ResultAsync } from "neverthrow";

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadEvents {}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface SubsystemsState {}

/**
 * EventBus interface for inter-subsystem communication.
 * Implementations should provide type-safe event emission and subscription.
 */
export interface EventBus {
	/**
	 * Emit an event with associated data.
	 * @param event - Event name (e.g., 'content:fetch:start')
	 * @param data - Event payload
	 * @returns true if event had listeners, false otherwise
	 */
	emit<K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]): boolean;

	/**
	 * Subscribe to an event.
	 * @param event - Event name to listen for
	 * @param handler - Handler function called when event is emitted
	 */
	on<K extends keyof LaunchpadEvents>(event: K, handler: (data: LaunchpadEvents[K]) => void): this;

	/**
	 * Unsubscribe from an event.
	 * @param event - Event name
	 * @param handler - Handler function to remove
	 */
	off<K extends keyof LaunchpadEvents>(event: K, handler: (data: LaunchpadEvents[K]) => void): this;

	/**
	 * Subscribe to all events.
	 * @param handler - Handler function called for any event
	 */
	onAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this;

	/**
	 * Unsubscribe from all events.
	 * @param handler - Handler function to remove
	 */
	offAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this;
}

/**
 * Optional interface for subsystems that support EventBus injection.
 * When implemented, the controller will automatically inject its EventBus instance.
 */
export interface EventBusAware {
	/**
	 * Inject EventBus into this subsystem.
	 * Called by the controller during subsystem registration.
	 * @param eventBus - EventBus instance to use for emitting/listening to events
	 */
	setEventBus(eventBus: EventBus): void;
}

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
	 * Get the current state of this subsystem.
	 * This should be a lightweight, synchronous operation.
	 * @returns Current state snapshot
	 */
	getState(): TState;
}

/**
 * Generic subsystem type that can optionally implement any controller interfaces.
 * This allows subsystems to work with or without the controller.
 *
 * @template TCommand - The command type this subsystem accepts (must extend BaseCommand)
 * @template TState - The state type this subsystem provides
 */
export type Subsystem<TCommand extends BaseCommand = BaseCommand, TState = unknown> = Partial<
	EventBusAware & Disconnectable & CommandExecutor<TCommand> & StateProvider<TState>
>;
