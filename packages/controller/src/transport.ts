/**
 * Transport system for controller communication.
 * Transports enable communication between the controller and external clients
 * (CLI, web dashboard, OSC, etc.)
 */

import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import type { ResultAsync } from "neverthrow";
import type { CommandDispatcher } from "./core/command-dispatcher.js";
import type { EventBus } from "./core/event-bus.js";
import type { StateStore } from "./core/state-store.js";

/**
 * Context passed to transports on start/stop
 */
export type TransportContext = {
	/** Logger for the transport */
	logger: Logger;
	/** Abort signal for lifecycle management */
	abortSignal: AbortSignal;
	/** EventBus for subscribing to events and emitting custom events */
	eventBus: EventBus;
	/** CommandDispatcher for executing commands on subsystems */
	commandDispatcher: CommandDispatcher;
	/** StateStore for querying current state */
	stateStore: StateStore;
};

/**
 * Transport interface
 * Transports handle communication between the controller and external clients.
 */
export interface Transport {
	/** Unique identifier for this transport */
	id: string;

	/**
	 * Start the transport
	 * Called when controller enters persistent mode
	 */
	start(ctx: TransportContext): ResultAsync<void, Error>;

	/**
	 * Stop the transport
	 * Called when controller is shutting down
	 */
	stop(ctx: TransportContext): ResultAsync<void, Error>;
}

/**
 * This function doesn't do anything, just a helper for typing transports
 */
export function defineTransport<T extends Transport>(transport: T): T {
	return transport;
}
