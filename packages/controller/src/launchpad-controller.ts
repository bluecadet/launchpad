import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import { isSelectedOperationalLogEvent } from "@bluecadet/launchpad-utils/logging";
import type {
	BaseCommand,
	CommandDescriptor,
	DisconnectReason,
	InstantiatedPlugin,
	PluginConfig,
	PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type {
	ControllerMode,
	StatusSnapshot,
	VersionedLaunchpadState,
} from "@bluecadet/launchpad-utils/types";
import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import type { ResolvedControllerConfig } from "./controller-config.js";
import { CommandDispatcher } from "./core/command-dispatcher.js";
import { CommandRegistry } from "./core/command-registry.js";
import { WorkflowRunner } from "./core/workflow-runner.js";
import type { WorkflowMap } from "./core/workflow-types.js";

export type { CoreEvents } from "./core/command-dispatcher.js";
export type { WorkflowMap, WorkflowStep, WorkflowStepOptions } from "./core/workflow-types.js";
export { workflowStepSchema } from "./core/workflow-types.js";

import type { AllEvents } from "./all-events.js";
import type { AllPluginsState } from "./all-plugin-state.js";

import { buildStatusSnapshot } from "./core/build-status-snapshot.js";
import { collectPluginMetrics } from "./core/collect-plugin-metrics.js";
import {
	acquireControllerInstanceLease,
	type ControllerInstanceLease,
} from "./core/controller-instance-lease.js";
import {
	type ControllerFileLogger,
	createFileLogger,
	type FileLoggerDependencies,
} from "./core/file-logger.js";
import { StateStore } from "./core/state-store.js";
import { deletePidFile, writePidFile } from "./pid-utils.js";
import { createIPCTransport } from "./transports/ipc-transport.js";

export interface ControllerDependencies extends FileLoggerDependencies {
	readonly acquireInstanceLease?: (
		pidFile: string,
		baseDirectory: string,
	) => ControllerInstanceLease | Result<ControllerInstanceLease, Error>;
}

export class LaunchpadController {
	private _config: ResolvedControllerConfig;
	private _mode: ControllerMode;
	private _baseDir: string;
	private _fileLogger: ControllerFileLogger | undefined;
	private readonly _dependencies: ControllerDependencies;
	private _instanceLease: ControllerInstanceLease | undefined;
	private _eventBus: EventBus<AllEvents>;
	private _stateStore: StateStore;
	private _commandDispatcher!: CommandDispatcher;
	private _workflowRunner: WorkflowRunner;
	private _plugins = new Map<string, InstantiatedPlugin>();
	private _pluginConfigs = new Map<string, PluginConfig>();
	private _commandRegistry = new CommandRegistry();
	private _abortController = new AbortController();
	private _isStarted = false;
	private _disposed = false;
	private _startupResult: ResultAsync<void, Error> | undefined;
	private _shutdownResult: ResultAsync<void, Error> | undefined;
	private _cleanupResult: ResultAsync<void, Error> | undefined;
	private _pidFileWritten = false;
	private _registrations = new Set<ResultAsync<void, Error>>();
	private _readyPhaseRun = false;

	constructor(
		config: ResolvedControllerConfig,
		baseDir: string,
		mode: ControllerMode = "task",
		dependencies: ControllerDependencies = {},
	) {
		this._config = config;
		this._mode = mode;
		this._baseDir = baseDir;
		this._dependencies = dependencies;
		this._eventBus = new EventBus<AllEvents>();
		this._stateStore = new StateStore(this._mode);
		this._workflowRunner = new WorkflowRunner(this._eventBus, (command) =>
			this.executeCommand(command),
		);
	}

	/** Reserve ownership before opening logging or invoking any plugin setup. */
	private initializeResources(): Result<ControllerFileLogger, Error> {
		if (this._disposed || this._shutdownResult) {
			return err(new Error("A stopped controller cannot be restarted"));
		}
		if (this._fileLogger) return ok(this._fileLogger);

		const acquire = this._dependencies.acquireInstanceLease ?? acquireControllerInstanceLease;
		return Result.fromThrowable(
			() => acquire(path.resolve(this._baseDir, this._config.pidFile), this._baseDir),
			ensureError,
		)()
			.andThen((lease) => ("release" in lease ? ok(lease) : lease))
			.andThen((lease) => {
				this._instanceLease = lease;
				return Result.fromThrowable(
					() =>
						createFileLogger(
							this._config.logging,
							this._baseDir,
							this._eventBus,
							this._dependencies,
						),
					ensureError,
				)()
					.map((fileLogger) => {
						this._fileLogger = fileLogger;
						this._eventBus.onAny(this.recordOperationalEvent);
						return fileLogger;
					})
					.mapErr((error) => {
						this.releaseInstanceLease();
						return error;
					});
			});
	}

	registerPlugin(
		plugin: PluginConfig & { manifest?: { commands?: readonly CommandDescriptor[] } },
	): ResultAsync<void, Error> {
		if (this._pluginConfigs.has(plugin.name)) {
			return errAsync(new Error(`Plugin '${plugin.name}' is already registered`));
		}

		const initialized = this.initializeResources();
		if (initialized.isErr()) return errAsync(initialized.error);
		const updateState = this._stateStore.getPluginUpdater(plugin.name);

		const registration = this.safeSetup(plugin, updateState, initialized.value)
			.andThen((instance) => {
				const manifestCommands = plugin.manifest?.commands ?? [];
				if (manifestCommands.length > 0 && !instance.executeCommand) {
					return this.rejectRegistration(
						plugin.name,
						instance,
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
					return this.rejectRegistration(plugin.name, instance, registerResult.error);
				}

				this._plugins.set(plugin.name, instance);
				this._pluginConfigs.set(plugin.name, plugin);
				this._fileLogger?.logger.verbose(`Registered plugin '${plugin.name}'`);

				// A plugin registered after the ready phase already ran cannot wait for it, so it
				// gets its own ready() right after setup — every plugin sees the hook exactly once.
				if (this._readyPhaseRun) {
					return this.safeReady(plugin.name, instance);
				}
				return okAsync(undefined);
			})
			.orElse((error) => {
				this._fileLogger?.logger.error(`Failed to register plugin '${plugin.name}'`);
				return errAsync(error);
			});
		this._registrations.add(registration);
		void registration.then(() => this._registrations.delete(registration));
		return registration;
	}

	private rejectRegistration(
		name: string,
		instance: InstantiatedPlugin,
		error: Error,
	): ResultAsync<void, Error> {
		return this.safeDisconnect(name, instance, { type: "error", error })
			.orElse(() => okAsync(undefined))
			.andThen(() => errAsync(error));
	}

	private safeDisconnect(
		name: string,
		plugin: InstantiatedPlugin,
		reason: DisconnectReason,
	): ResultAsync<void, Error> {
		this._fileLogger?.logger.verbose(`Disconnecting plugin '${name}'`);
		return ResultAsync.fromThrowable(
			async () => await plugin.disconnect?.(reason),
			ensureError,
		)().andThen((result) => result ?? okAsync(undefined));
	}

	/** A plugin setup that throws synchronously (instead of returning errAsync)
	 * must surface as a registration error, not unwind into the caller. */
	private safeSetup(
		plugin: PluginConfig,
		updateState: (producer: (draft: unknown) => void) => void,
		fileLogger: ControllerFileLogger,
	): ResultAsync<InstantiatedPlugin, Error> {
		return ResultAsync.fromThrowable(
			async () => await plugin.setup(this.getPluginCtx(plugin.name, updateState, fileLogger)),
			ensureError,
		)().andThen((result) => result);
	}

	/**
	 * Run the post-setup lifecycle phase: every registered plugin's optional `ready()`, in
	 * registration order.
	 *
	 * Registration is caller-driven, so only the host knows when the plugin set is complete —
	 * it calls `ready()` once registration finishes. Plugin work that depends on other plugins
	 * existing (announcing state on the event bus, for example) belongs here rather than in
	 * `setup()`, which runs while later plugins have not been set up yet.
	 *
	 * Idempotent: repeat calls are no-ops, and plugins registered afterwards are readied on
	 * registration instead.
	 */
	ready(): ResultAsync<void, never> {
		if (this._readyPhaseRun) {
			return okAsync(undefined);
		}
		this._readyPhaseRun = true;

		// Sequential, not `combine`: mapping to ResultAsyncs first would start every
		// ready() body eagerly, so only invocation would be ordered. Chaining makes
		// completion order match registration order too.
		const readyPhase = Array.from(this._plugins.entries()).reduce<ResultAsync<void, never>>(
			(previous, [name, plugin]) => previous.andThen(() => this.safeReady(name, plugin)),
			okAsync(undefined),
		);

		return readyPhase.map(() => {
			this._fileLogger?.logger.verbose("All plugins ready");
			return undefined;
		});
	}

	/** A plugin `ready()` that fails or throws is logged and contained: startup continues and
	 * every other plugin still gets its own `ready()`. */
	private safeReady(name: string, plugin: InstantiatedPlugin): ResultAsync<void, never> {
		if (!plugin.ready) {
			return okAsync(undefined);
		}

		this._fileLogger?.logger.verbose(`Readying plugin '${name}'`);
		return ResultAsync.fromThrowable(async () => await plugin.ready?.(), ensureError)()
			.andThen((result) => result ?? okAsync(undefined))
			.orElse((error) => {
				this._fileLogger?.logger.error(`Plugin '${name}' failed to become ready: ${error.message}`);
				return okAsync(undefined);
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

	/** Single-flight startup; repeated callers observe the same attempt and Result. */
	start(): ResultAsync<void, Error> {
		if (this._disposed || this._shutdownResult) {
			return errAsync(new Error("A stopped controller cannot be restarted"));
		}
		if (this._startupResult) return this._startupResult;
		const initialized = this.initializeResources();
		if (initialized.isErr()) {
			this._startupResult = this.abandonStartup(initialized.error);
			return this._startupResult;
		}

		this._fileLogger?.logger.verbose(`Starting controller in ${this._mode} mode`);
		this._commandDispatcher = new CommandDispatcher(this._eventBus, this._commandRegistry);

		if (this._mode === "persistent") {
			const pidFile = path.resolve(this._baseDir, this._config.pidFile);
			const socketPath = path.resolve(this._baseDir, this._config.socketPath);
			const writePidResult = writePidFile(pidFile, process.pid);
			if (writePidResult.isErr()) {
				this._startupResult = this.abandonStartup(writePidResult.error);
				return this._startupResult;
			}
			this._pidFileWritten = true;
			this._startupResult = this.registerPlugin(createIPCTransport({ socketPath }))
				.andTee(() => {
					this._isStarted = true;
					this._fileLogger?.logger.verbose("Controller started with IPC transport");
				})
				.orElse((error) => this.abandonStartup(error));
			return this._startupResult;
		}

		this._isStarted = true;
		this._fileLogger?.logger.verbose("Controller started");
		this._startupResult = okAsync(undefined);
		return this._startupResult;
	}

	private readonly recordOperationalEvent = (event: string, payload: unknown): void => {
		if (!isSelectedOperationalLogEvent(event)) return;
		this._fileLogger?.recordEvent(event, payload);
	};

	private releaseInstanceLease(): Result<void, Error> {
		const lease = this._instanceLease;
		this._instanceLease = undefined;
		return Result.fromThrowable(() => lease?.release(), ensureError)().andThen(
			(result) => result ?? ok(undefined),
		);
	}

	private closeOwnedResources(): ResultAsync<void, Error> {
		this._eventBus.offAny(this.recordOperationalEvent);
		const fileLogger = this._fileLogger;
		if (!fileLogger) return this.releaseInstanceLease().asyncAndThen(() => okAsync(undefined));

		// A bounded close timeout stops waiting, not physical canonical/checkpoint I/O.
		// Keep project ownership until the source's unbounded completion settles.
		let releaseResult: Result<void, Error> | undefined;
		void fileLogger.whenClosed().then(() => {
			releaseResult = this.releaseInstanceLease();
		});
		return ResultAsync.fromThrowable(async () => await fileLogger.close(), ensureError)().andThen(
			() => releaseResult ?? ok(undefined),
		);
	}

	private abandonStartup(error: Error): ResultAsync<void, Error> {
		return this.cleanup({ type: "error", error })
			.orElse(() => okAsync(undefined))
			.andThen(() => errAsync(error));
	}

	private cleanup(reason: DisconnectReason): ResultAsync<void, Error> {
		if (this._cleanupResult) return this._cleanupResult;
		this._isStarted = false;
		this._disposed = true;
		this._fileLogger?.logger.verbose("Controller is shutting down");
		this._abortController.abort();

		// Plugin setup may still be settling when stop is called. Keep ownership until
		// all admitted registrations have completed, then disconnect their instances.
		this._cleanupResult = ResultAsync.combine(Array.from(this._registrations))
			.orElse(() => okAsync([]))
			.andThen(() => {
				if (this._pidFileWritten) {
					deletePidFile(path.resolve(this._baseDir, this._config.pidFile));
					this._pidFileWritten = false;
				}
				const disconnectResults = Array.from(this._plugins.entries()).map(([name, plugin]) =>
					this.safeDisconnect(name, plugin, reason),
				);
				return ResultAsync.combine(disconnectResults)
					.map((): Error | undefined => undefined)
					.orElse((error) => okAsync(error));
			})
			.andThen((disconnectError) => {
				if (!disconnectError) this._fileLogger?.logger.verbose("All plugins disconnected");
				return this.closeOwnedResources().andThen(() =>
					disconnectError ? errAsync(disconnectError) : okAsync(undefined),
				);
			});
		return this._cleanupResult;
	}

	/** Dispose even when startup was never attempted, and serialize with pending startup. */
	stop(): ResultAsync<void, Error> {
		if (this._shutdownResult) return this._shutdownResult;
		if (this._cleanupResult) return this._cleanupResult;
		const startupSettled =
			this._startupResult?.orElse(() => okAsync(undefined)) ?? okAsync(undefined);
		this._shutdownResult = startupSettled.andThen(() => {
			if (!this._isStarted) return this.cleanup({ type: "manual" });
			this._fileLogger?.logger.verbose("Stopping controller");
			return this.runWorkflow("stop")
				.map((): Error | undefined => undefined)
				.orElse((error) => okAsync(error))
				.andThen((workflowError) =>
					this.cleanup(
						workflowError ? { type: "error", error: workflowError } : { type: "manual" },
					).andThen(() => (workflowError ? errAsync(workflowError) : okAsync(undefined))),
				);
		});
		return this._shutdownResult;
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

	setWorkflows(workflows: WorkflowMap): void {
		this._workflowRunner.setWorkflows(workflows);
	}

	runWorkflow(name: string): ResultAsync<void, Error> {
		return this._workflowRunner.run(name);
	}

	getRegisteredCommandIds(): string[] {
		return this._commandRegistry.getRegisteredCommandIds();
	}

	private buildSnapshot(): StatusSnapshot {
		return buildStatusSnapshot(this._stateStore.getState(), this._pluginConfigs.values());
	}

	private collectMetrics(): readonly MetricObservation[] {
		return collectPluginMetrics(
			this._stateStore.getState(),
			this._pluginConfigs.values(),
			(pluginName) => {
				this._fileLogger?.logger.warn(`Metric observation failed for plugin '${pluginName}'`);
			},
		);
	}

	private getPluginCtx(
		pluginName: string,
		updateState: (producer: (draft: unknown) => void) => void,
		fileLogger: ControllerFileLogger,
	): PluginContext<unknown> {
		return {
			eventBus: this._eventBus,
			logger: fileLogger.logger.child(pluginName),
			...(fileLogger.source === undefined ? {} : { logSource: fileLogger.source }),
			cwd: this._baseDir,
			mode: this._mode,
			getStatusSnapshot: () => this.buildSnapshot(),
			abortSignal: this._abortController.signal,
			dispatchCommand: (command: BaseCommand) => this.executeCommand(command),
			getGlobalState: () => this.getState(),
			onGlobalStatePatch: (handler) => this._stateStore.onPatch(handler),
			collectMetrics: () => this.collectMetrics(),
			updateState,
		};
	}
}
