import path from "node:path";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import type {
	BaseCommand,
	CommandDescriptor,
	DisconnectReason,
	InstantiatedPlugin,
	PluginConfig,
	PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ControllerMode, ResolvedControllerConfig } from "./controller-config.js";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { CommandRegistry } from "./core/command-registry.js";

export type { CoreEvents } from "./core/command-dispatcher.js";

import type { AllEvents } from "./all-events.js";
import type { AllPluginsState } from "./all-plugin-state.js";

import { createFileLogger } from "./core/file-logger.js";
import { StateStore } from "./core/state-store.js";
import { deletePidFile, getDaemonPid, writePidFile } from "./pid-utils.js";
import { createIPCTransport } from "./transports/ipc-transport.js";

export class LaunchpadController {
	private _config: ResolvedControllerConfig;
	private _mode: ControllerMode;
	private _baseDir: string;
	private _logger: Logger;
	private _eventBus: EventBus<AllEvents>;
	private _stateStore: StateStore;
	private _commandDispatcher!: CommandDispatcher;
	private _plugins = new Map<string, InstantiatedPlugin>();
	private _pluginConfigs = new Map<string, PluginConfig>();
	private _commandRegistry = new CommandRegistry();
	private _abortController = new AbortController();
	private _isStarted = false;
	private _dashboardRegistry = new DashboardRegistry();
	private _statusRegistry = new StatusRegistry();
	private _shutdownInProgress = false;

	constructor(config: ResolvedControllerConfig, baseDir: string, mode: ControllerMode = "task") {
		this._config = config;
		this._mode = mode;
		this._baseDir = baseDir;
		this._eventBus = new EventBus<AllEvents>();
		this._logger = createFileLogger(this._config.logging, baseDir, this._eventBus);
		this._stateStore = new StateStore(this._mode);
	}

	registerPlugin(
		plugin: PluginConfig & { manifest?: { commands?: readonly CommandDescriptor[] } },
	): ResultAsync<void, Error> {
		if (this._pluginConfigs.has(plugin.name)) {
			return errAsync(new Error(`Plugin '${plugin.name}' is already registered`));
		}

		const updateState = this._stateStore.getPluginUpdater(plugin.name);

		return plugin
			.setup(this.getPluginCtx(plugin.name, updateState))
			.andThen((instance) => {
				const manifestCommands = plugin.manifest?.commands ?? [];
				if (manifestCommands.length > 0 && !instance.executeCommand) {
					return errAsync(
						new Error(
							`Plugin '${plugin.name}' declares manifest commands but does not implement executeCommand`,
						),
					);
				}

				const registerResult = this._commandRegistry.registerMany(
					plugin.name,
					manifestCommands,
					(command) => instance.executeCommand?.(command) ?? errAsync(new Error()),
				);
				if (registerResult.isErr()) {
					instance.disconnect?.({ type: "error", error: registerResult.error });
					return errAsync(registerResult.error);
				}

				this._plugins.set(plugin.name, instance);
				this._pluginConfigs.set(plugin.name, plugin);
				this._logger.verbose(`Registered plugin '${plugin.name}'`);
				return okAsync(undefined);
			})
			.orElse((error) => {
				this._logger.error(`Failed to register plugin '${plugin.name}'`);
				return errAsync(error);
			});
	}

	getPlugin(name: string): InstantiatedPlugin | undefined {
		return this._plugins.get(name);
	}

	hasPlugin(name: string): boolean {
		return this._plugins.has(name);
	}

	getPluginNames(): string[] {
		return Array.from(this._plugins.keys());
	}

	start(): ResultAsync<void, Error> {
		if (this._isStarted) {
			return okAsync(undefined);
		}

		this._logger.verbose(`Starting controller in ${this._mode} mode`);
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._commandRegistry);

		if (this._mode === "persistent") {
			const pidFile = path.resolve(this._baseDir, this._config.pidFile);
			const socketPath = path.resolve(this._baseDir, this._config.socketPath);

			const daemonPidResult = getDaemonPid(pidFile);
			if (daemonPidResult.isOk() && daemonPidResult.value !== null) {
				return errAsync(new Error(`Controller already running with PID ${daemonPidResult.value}`));
			}

			const writePidResult = writePidFile(pidFile, process.pid);
			if (writePidResult.isErr()) {
				return errAsync(writePidResult.error);
			}

			return this.registerPlugin(createIPCTransport({ socketPath })).andTee(() => {
				this._isStarted = true;
				this._logger.verbose("Controller started with IPC transport");
				return undefined;
			});
		}

		this._isStarted = true;
		this._logger.verbose("Controller started");
		return okAsync(undefined);
	}

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

	stop(): ResultAsync<void, Error> {
		if (!this._isStarted) {
			return okAsync(undefined);
		}
		this._logger.verbose("Stopping controller");

		const reason: DisconnectReason = { type: "manual" };
		return this.cleanup(reason);
	}

	executeCommand(command: BaseCommand): ResultAsync<unknown, Error> {
		if (!this._isStarted) {
			return errAsync(new Error("Controller must be started before executing commands"));
		}

		return this._commandDispatcher.dispatch(command);
	}

	getMode(): ControllerMode {
		return this._mode;
	}

	getState(): VersionedLaunchpadState<AllPluginsState> {
		return this._stateStore.getState();
	}

	getEventBus(): EventBus<AllEvents> {
		return this._eventBus;
	}

	getAbortSignal(): AbortSignal {
		return this._abortController.signal;
	}

	isStarted(): boolean {
		return this._isStarted;
	}

	getDashboardRegistry(): DashboardRegistry {
		return this._dashboardRegistry;
	}

	getStatusRegistry(): StatusRegistry {
		return this._statusRegistry;
	}

	getPluginStartupCommands(name: string): readonly BaseCommand[] {
		const plugin = this._pluginConfigs.get(name);
		if (!plugin) {
			return [];
		}

		return plugin.manifest?.lifecycle?.startupCommands ?? [];
	}

	getRegisteredCommandIds(): string[] {
		return this._commandRegistry.getRegisteredCommandIds();
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
