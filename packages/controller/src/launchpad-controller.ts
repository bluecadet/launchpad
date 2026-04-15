import path from "node:path";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import type {
	BaseCommand,
	DisconnectReason,
	InstantiatedPlugin,
	PluginConfig,
	PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ControllerMode, ResolvedControllerConfig } from "./controller-config.js";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { createFileLogger } from "./core/file-logger.js";
import { StateStore } from "./core/state-store.js";
import { deletePidFile, getDaemonPid, writePidFile } from "./pid-utils.js";
import { createIPCTransport } from "./transports/ipc-transport.js";

/**
 * LaunchpadController is the central orchestrator for Launchpad.
 *
 * Responsibilities:
 * - Event bus for inter-plugin communication
 * - State management via event subscriptions
 * - Command dispatching to plugins
 * - Plugin lifecycle management
 * - IPC transport for daemon communication (persistent mode)
 * - Optional transports (WebSocket, OSC, etc.) - Future
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
	private _plugins = new Map<string, InstantiatedPlugin>();
	private _abortController = new AbortController();
	private _isStarted = false;
	private _dashboardRegistry = new DashboardRegistry();
	private _statusRegistry = new StatusRegistry();
	// Future: private _transports: Transport[] = [];

	constructor(config: ResolvedControllerConfig, baseDir: string, mode: ControllerMode = "task") {
		this._config = config;
		this._mode = mode;
		this._baseDir = baseDir;
		this._eventBus = new EventBus();
		this._logger = createFileLogger(this._config.logging, baseDir, this._eventBus);
		this._stateStore = new StateStore(this._mode);
	}

	/**
	 * Register a plugin with the controller.
	 * Must be called before start().
	 */
	registerPlugin(plugin: PluginConfig): ResultAsync<void, Error> {
		const name = plugin.name;

		const updateState = this._stateStore.getPluginUpdater(plugin.name);

		return plugin
			.setup(this.getPluginCtx(name, updateState))
			.map((instance) => {
				this._plugins.set(plugin.name, instance);
				this._logger.verbose(`Registered plugin '${name}'`);
				return undefined;
			})
			.orElse((error) => {
				this._logger.error(`Failed to register plugin '${name}'`);
				return errAsync(error);
			});
	}

	/**
	 * Get a registered plugin by name
	 */
	getPlugin(name: string): InstantiatedPlugin | undefined {
		return this._plugins.get(name);
	}

	/**
	 * Check if a plugin is registered
	 */
	hasPlugin(name: string): boolean {
		return this._plugins.has(name);
	}

	/**
	 * Get all registered plugin names
	 */
	getPluginNames(): string[] {
		return Array.from(this._plugins.keys());
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

		// Initialize command dispatcher with registered plugins
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._plugins);

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

			return this.registerPlugin(
				createIPCTransport({
					socketPath,
				}),
			).andTee(() => {
				this._isStarted = true;
				this._logger.verbose("Controller started with IPC transport");
				return undefined;
			});
		}

		// Future: Start optional transports
		// if (this._mode === "persistent" && this._transports.length > 0) {
		//   return this._startTransports();
		// }

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

		const disconnectResults = Array.from(this._plugins.entries()).map(([name, plugin]) => {
			if (plugin.disconnect) {
				this._logger.verbose(`Disconnecting plugin '${name}'`);
				return plugin.disconnect(reason);
			}
			return okAsync(undefined);
		});

		return ResultAsync.combine(disconnectResults).map(() => {
			this._logger.verbose("All plugins disconnected");
			return undefined;
		});
	}

	/**
	 * Stop the controller.
	 * Stops IPC transport, disconnects plugins, aborts pending operations,
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
	 * at the plugin level via CommandExecutor<TCommand>.
	 */
	executeCommand(command: BaseCommand): ResultAsync<unknown, Error> {
		if (!this._isStarted) {
			return errAsync(new Error("Controller must be started before executing commands"));
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

	/**
	 * Get the dashboard contribution registry.
	 */
	getDashboardRegistry(): DashboardRegistry {
		return this._dashboardRegistry;
	}

	/**
	 * Get the status section registry.
	 */
	getStatusRegistry(): StatusRegistry {
		return this._statusRegistry;
	}

	private getPluginCtx(
		pluginName: string,
		updateState: (producer: (draft: unknown) => void) => void,
	): PluginContext<unknown> {
		return {
			eventBus: this._eventBus,
			logger: this._logger.child(pluginName),
			cwd: this._baseDir,
			abortSignal: this._abortController.signal,
			dispatchCommand: (command: BaseCommand) => this.executeCommand(command),
			getGlobalState: () => this.getState(),
			onGlobalStatePatch: (handler) => this._stateStore.onPatch(handler),
			updateState,
			dashboardRegistry: this._dashboardRegistry,
			statusRegistry: this._statusRegistry,
		};
	}
}
