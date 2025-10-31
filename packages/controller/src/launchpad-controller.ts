import path from "node:path";
import type { BaseCommand, Subsystem } from "@bluecadet/launchpad-utils/controller-interfaces";
import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import { LogManager } from "@bluecadet/launchpad-utils/log-manager";
import { onExit } from "@bluecadet/launchpad-utils/on-exit";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ControllerConfig, ControllerMode } from "./controller-config.js";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { EventBus } from "./core/event-bus.js";
import { type LaunchpadState, StateStore } from "./core/state-store.js";
import { deletePidFile, getDaemonPid, writePidFile } from "./pid-utils.js";
import type { Transport } from "./transport.js";
import { createIPCTransport } from "./transports/ipc-transport.js";

export type { LaunchpadState };

/**
 * LaunchpadController is the central orchestrator for Launchpad.
 *
 * Responsibilities:
 * - Event bus for inter-subsystem communication
 * - State management via event subscriptions
 * - Command dispatching to subsystems
 * - Subsystem lifecycle management
 * - IPC transport for daemon communication (persistent mode)
 * - Optional transports (WebSocket, OSC, etc.) - Future
 *
 * Modes:
 * - Task mode: Ephemeral controller for single commands (no transports)
 * - Persistent mode: Long-running controller with IPC transport enabled
 */
export class LaunchpadController {
	private _config: ControllerConfig;
	private _mode: ControllerMode;
	private _baseDir: string;
	private _logger: Logger;
	private _eventBus: EventBus;
	private _stateStore: StateStore;
	private _commandDispatcher!: CommandDispatcher;
	private _subsystems = new Map<string, Subsystem>();
	private _abortController = new AbortController();
	private _isStarted = false;
	private _ipcTransport: Transport | null = null;
	// Future: private _transports: Transport[] = [];

	constructor(
		config: ControllerConfig,
		logger: Logger,
		baseDir: string,
		mode: ControllerMode = "task",
	) {
		this._config = config;
		this._mode = mode;
		this._baseDir = baseDir;
		this._logger = LogManager.getLogger("controller", logger);

		// Core components (always created in both modes)
		this._eventBus = new EventBus();
		this._stateStore = new StateStore(this._subsystems, this._mode);
	}

	/**
	 * Register a subsystem with the controller.
	 * Must be called before start().
	 *
	 * If the subsystem implements EventBusAware, the EventBus will be injected.
	 */
	registerSubsystem(name: string, instance: Subsystem): void {
		this._subsystems.set(name, instance);
		this._stateStore.registerSubsystem(name, instance);

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
	 * Initializes the command dispatcher and starts IPC transport (if persistent mode).
	 * In persistent mode, also manages PID file lifecycle.
	 */
	start(): ResultAsync<void, Error> {
		if (this._isStarted) {
			return okAsync(undefined);
		}

		this._logger.debug(`Starting controller in ${this._mode} mode`);

		// Initialize command dispatcher with registered subsystems
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._subsystems);

		// Start IPC transport in persistent mode (built-in infrastructure)
		if (this._mode === "persistent") {
			const pidFile = path.resolve(this._baseDir, this._config.pidFile);
			const socketPath = path.resolve(this._baseDir, this._config.socketPath);

			// Check if daemon already running
			const daemonPidResult = getDaemonPid(pidFile);
			if (daemonPidResult.isOk() && daemonPidResult.value !== null) {
				return errAsync(new Error(`Controller already running with PID ${daemonPidResult.value}`));
			}

			// Write PID file
			const writePidResult = writePidFile(pidFile, process.pid);
			if (writePidResult.isErr()) {
				return errAsync(writePidResult.error);
			}

			this._ipcTransport = createIPCTransport({
				socketPath,
			});

			const transportContext = {
				logger: this._logger,
				abortSignal: this._abortController.signal,
				eventBus: this._eventBus,
				commandDispatcher: this._commandDispatcher,
				stateStore: this._stateStore,
			};

			// Register cleanup handlers to remove PID file on exit and close transports
			onExit(() => {
				deletePidFile(pidFile);
				this._ipcTransport?.stop(transportContext);
			});

			return this._ipcTransport.start(transportContext).map(() => {
				this._isStarted = true;
				this._logger.debug("Controller started with IPC transport");
				return undefined;
			});
		}

		// Future: Start optional transports
		// if (this._mode === "persistent" && this._transports.length > 0) {
		//   return this._startTransports();
		// }

		this._isStarted = true;
		this._logger.debug("Controller started");

		return okAsync(undefined);
	}

	/**
	 * Stop the controller.
	 * Stops IPC transport, disconnects subsystems, aborts pending operations,
	 * and cleans up PID file (in persistent mode).
	 */
	stop(): ResultAsync<void, Error> {
		if (!this._isStarted) {
			return okAsync(undefined);
		}

		this._logger.debug("Stopping controller");

		// Abort any pending operations (triggers transport cleanup via abortSignal)
		this._abortController.abort();

		// Stop IPC transport if it was started
		const transportStopPromise = this._ipcTransport
			? this._ipcTransport.stop({
					logger: this._logger,
					abortSignal: this._abortController.signal,
					eventBus: this._eventBus,
					commandDispatcher: this._commandDispatcher,
					stateStore: this._stateStore,
				})
			: okAsync(undefined);

		// Future: Stop optional transports
		// const transportsStopPromises = this._transports.map(t => t.stop(ctx));

		// Disconnect subsystems (if they implement Disconnectable)
		const disconnectResults = Array.from(this._subsystems.entries()).map(([name, subsystem]) => {
			if (subsystem.disconnect) {
				this._logger.debug(`Disconnecting subsystem '${name}'`);
				return subsystem.disconnect();
			}
			return okAsync(undefined);
		});

		return ResultAsync.combine([transportStopPromise, ...disconnectResults]).map(() => {
			// Clean up PID file in persistent mode
			if (this._mode === "persistent") {
				const pidFile = path.resolve(this._baseDir, this._config.pidFile);
				deletePidFile(pidFile);
			}

			this._isStarted = false;
			this._ipcTransport = null;
			this._logger.debug("Controller stopped");
			return undefined;
		});
	}

	/**
	 * Execute a command through the dispatcher.
	 * The controller must be started before executing commands.
	 *
	 * The controller treats commands generically - type safety is enforced
	 * at the subsystem level via CommandExecutor<TCommand>.
	 */
	executeCommand(command: BaseCommand): ResultAsync<unknown, Error> {
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
