import type { BaseCommand, Logger, Subsystem } from "@bluecadet/launchpad-utils";
import { LogManager } from "@bluecadet/launchpad-utils";
import { okAsync, type ResultAsync } from "neverthrow";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import type { ControllerConfig, ControllerMode } from "./core/controller-config.js";
import { EventBus } from "./core/event-bus.js";
import { StateStore } from "./core/state-store.js";

/**
 * LaunchpadController is the central orchestrator for Launchpad.
 *
 * Responsibilities:
 * - Event bus for inter-subsystem communication
 * - State management via event subscriptions
 * - Command dispatching to subsystems
 * - Subsystem lifecycle management
 * - Transport management (Phase 2)
 *
 * Modes:
 * - Task mode: Ephemeral controller for single commands (no transports)
 * - Persistent mode: Long-running controller with transports (Phase 2)
 */
export class LaunchpadController {
	private _mode: ControllerMode;
	private _logger: Logger;
	private _eventBus: EventBus;
	private _stateStore: StateStore;
	private _commandDispatcher!: CommandDispatcher;
	private _subsystems = new Map<string, Subsystem>();
	private _abortController = new AbortController();
	private _isStarted = false;

	constructor(config: ControllerConfig, logger: Logger, mode: ControllerMode = "task") {
		this._mode = mode;
		this._logger = LogManager.getLogger("controller", logger);

		// Core components (always created in both modes)
		this._eventBus = new EventBus();
		this._stateStore = new StateStore(this._subsystems);
		this._stateStore.setSystemState("mode", mode);

		// Phase 2: Instantiate transports in persistent mode
		// if (mode === 'persistent') {
		//   this._transports = config.transports.map(createTransport);
		// }
	}

	/**
	 * Register a subsystem with the controller.
	 * Must be called before start().
	 *
	 * If the subsystem implements EventBusAware, the EventBus will be injected.
	 */
	registerSubsystem(name: string, instance: Subsystem): void {
		if (this._isStarted) {
			throw new Error(`Cannot register subsystem '${name}' after controller has started`);
		}

		this._subsystems.set(name, instance);

		// Type-safe EventBus injection (optional interface)
		if (instance.setEventBus) {
			instance.setEventBus(this._eventBus);
			this._logger.debug(`Registered subsystem '${name}' with EventBus injection`);
		} else {
			this._logger.debug(`Registered subsystem '${name}' (no EventBus support)`);
		}
	}

	/**
	 * Get a registered subsystem by name
	 */
	getSubsystem(name: string): Subsystem | undefined {
		return this._subsystems.get(name);
	}

	/**
	 * Check if a subsystem is registered
	 */
	hasSubsystem(name: string): boolean {
		return this._subsystems.has(name);
	}

	/**
	 * Get all registered subsystem names
	 */
	getSubsystemNames(): string[] {
		return Array.from(this._subsystems.keys());
	}

	/**
	 * Start the controller.
	 * Initializes the command dispatcher and starts transports (if persistent mode).
	 */
	async start(): Promise<ResultAsync<void, Error>> {
		if (this._isStarted) {
			return okAsync(undefined);
		}

		this._logger.info(`Starting controller in ${this._mode} mode`);

		// Initialize command dispatcher with registered subsystems
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._subsystems);

		// Phase 2: Start transports in persistent mode
		// if (this._mode === 'persistent' && this._transports.length > 0) {
		//   await this._startTransports();
		// }

		this._isStarted = true;
		this._logger.info("Controller started");

		return okAsync(undefined);
	}

	/**
	 * Stop the controller.
	 * Disconnects subsystems, stops transports, and aborts pending operations.
	 */
	async stop(): Promise<ResultAsync<void, Error>> {
		if (!this._isStarted) {
			return okAsync(undefined);
		}

		this._logger.info("Stopping controller");

		// Abort any pending operations
		this._abortController.abort();

		// Phase 2: Stop transports
		// if (this._transports.length > 0) {
		//   await this._stopTransports();
		// }

		// Disconnect subsystems (if they implement Disconnectable)
		for (const [name, subsystem] of this._subsystems) {
			if (subsystem.disconnect) {
				this._logger.debug(`Disconnecting subsystem '${name}'`);
				await subsystem.disconnect();
			}
		}

		this._isStarted = false;
		this._logger.info("Controller stopped");

		return okAsync(undefined);
	}

	/**
	 * Execute a command through the dispatcher.
	 * The controller must be started before executing commands.
	 *
	 * The controller treats commands generically - type safety is enforced
	 * at the subsystem level via CommandExecutor<TCommand>.
	 */
	async executeCommand(command: BaseCommand): Promise<ResultAsync<unknown, Error>> {
		if (!this._isStarted) {
			throw new Error("Controller must be started before executing commands");
		}

		return this._commandDispatcher.dispatch(command);
	}

	/**
	 * Get the current controller mode
	 */
	getMode(): ControllerMode {
		return this._mode;
	}

	/**
	 * Get the current state (readonly)
	 */
	getState() {
		return this._stateStore.getState();
	}

	/**
	 * Get the EventBus instance (useful for plugins)
	 */
	getEventBus(): EventBus {
		return this._eventBus;
	}

	/**
	 * Get the abort signal for this controller's lifecycle
	 */
	getAbortSignal(): AbortSignal {
		return this._abortController.signal;
	}

	/**
	 * Check if the controller is started
	 */
	isStarted(): boolean {
		return this._isStarted;
	}
}
