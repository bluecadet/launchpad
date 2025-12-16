import path from "node:path";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type {
	DisconnectReason,
	InstantiatedSubsystem,
	SubsystemConfig,
	SubsystemContext,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import {
	type ControllerConfig,
	type ControllerMode,
	controllerConfigSchema,
	type ResolvedControllerConfig,
} from "./controller-config.js";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { createFileLogger } from "./core/file-logger.js";
import { StateStore } from "./core/state-store.js";
import { deletePidFile, getDaemonPid, writePidFile } from "./pid-utils.js";
import { createIPCTransport } from "./transports/ipc-transport.js";

/**
 * LaunchpadController is the central orchestrator for Launchpad.
 *
 * Responsibilities:
 * - Event bus for inter-subsystem communication
 * - State management via event subscriptions
 * - Command dispatching to subsystems
 * - Subsystem lifecycle management
 * - IPC transport for daemon communication (persistent mode)
 *
 * Modes:
 * - Task mode: Ephemeral controller for single commands (no transports)
 * - Persistent mode: Long-running controller with IPC transport enabled
 */
export class LaunchpadController {
	private _config: ResolvedControllerConfig;
	private _mode: ControllerMode;
	private _baseDir: string;
	private _logger: Logger;
	private _eventBus: EventBus;
	private _stateStore: StateStore;
	private _commandDispatcher!: CommandDispatcher;
	private _subsystems = new Map<string, InstantiatedSubsystem>();
	private _abortController = new AbortController();
	private _isStarted = false;

	constructor(config: ControllerConfig, baseDir: string, mode: ControllerMode = "task") {
		this._config = controllerConfigSchema.parse(config);
		this._mode = mode;
		this._baseDir = baseDir;
		this._eventBus = new EventBus();
		this._logger = createFileLogger(this._config.logging, baseDir, this._eventBus);
		this._stateStore = new StateStore(this._subsystems, this._mode);
	}

	/**
	 * Register a subsystem with the controller.
	 * Must be called before start().
	 *
	 * If the subsystem implements EventBusAware, the EventBus will be injected.
	 */
	registerSubsystem<
		TState = unknown,
		E = Error,
		TSubsystem extends InstantiatedSubsystem<TState> = InstantiatedSubsystem<TState>,
	>(subsystem: SubsystemConfig<TState, E, TSubsystem>): ResultAsync<TSubsystem, E> {
		const name = subsystem.name;

		return subsystem
			.setup(this.getSubsystemCtx(name))
			.andTee((instance) => {
				this._subsystems.set(subsystem.name, instance);
				this._stateStore.registerSubsystem(name, instance);

				this._logger.verbose(`Registered subsystem '${name}'`);
			})
			.orTee(() => {
				this._logger.error(`Failed to register subsystem '${name}'`);
			});
	}

	/**
	 * Get a registered subsystem by name
	 */
	getSubsystem(name: string): InstantiatedSubsystem | undefined {
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
	 * Get all registered subsystems
	 */
	getSubsystems(): ReadonlyMap<string, InstantiatedSubsystem> {
		return this._subsystems;
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

		this._logger.verbose(`Starting controller in ${this._mode} mode`);

		// Initialize command dispatcher with registered subsystems
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._logger, this._subsystems);

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

			return this.registerSubsystem(
				createIPCTransport({
					socketPath,
				}),
			)
				.andTee(() => {
					this._isStarted = true;
					this._logger.verbose("Controller started with IPC transport");
					return undefined;
				})
				.map(() => {}); // return void
		}

		this._isStarted = true;
		this._logger.verbose("Controller started");

		return okAsync(undefined);
	}

	private _shutdownInProgress = false;

	private cleanup(reason: DisconnectReason): ResultAsync<void, Error> {
		this._isStarted = false;

		if (this._shutdownInProgress) {
			return errAsync(new Error("Shutdown already in progress"));
		}
		this._logger.verbose("Controller is shutting down");
		this._shutdownInProgress = true;

		this._abortController.abort();

		const pidFile = path.resolve(this._baseDir, this._config.pidFile);
		deletePidFile(pidFile);

		const disconnectResults = Array.from(this._subsystems.entries()).map(([name, subsystem]) => {
			if (subsystem.disconnect) {
				this._logger.verbose(`Disconnecting subsystem '${name}'`);
				return subsystem.disconnect(reason);
			}
			return okAsync(undefined);
		});

		return ResultAsync.combine(disconnectResults).map(() => {
			this._logger.verbose("All subsystems disconnected");
			return undefined;
		});
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
		this._logger.verbose("Stopping controller");

		const reason: DisconnectReason = { type: "manual" };

		return this.cleanup(reason);
	}

	/**
	 * Execute a command through the dispatcher.
	 * The controller must be started before executing commands.
	 *
	 * The controller treats commands generically - type safety is enforced
	 * at the subsystem level via CommandExecutor<TCommand>.
	 */
	executeCommand(command: AnyCommand): ResultAsync<unknown, Error> {
		if (!this._isStarted) {
			throw new Error("Controller must be started before executing commands");
		}

		if (command.type === "system.shutdown") {
			return this.cleanup({
				type: "manual",
			});
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

	private getSubsystemCtx(subsystemName: string): SubsystemContext {
		return {
			eventBus: this._eventBus,
			logger: this._logger.child(subsystemName),
			cwd: this._baseDir,
			abortSignal: this._abortController.signal,
			dispatchCommand: (command: AnyCommand) => this.executeCommand(command),
			getState: () => this.getState(),
			onStatePatch: (handler) => this._stateStore.onPatch(handler),
		};
	}
}
