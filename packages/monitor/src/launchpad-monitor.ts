import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { PluginDriver } from "@bluecadet/launchpad-utils/plugin-driver";
import type { PatchHandler } from "@bluecadet/launchpad-utils/state-patcher";
import {
	type DashboardRegistry,
	defineSubsystem,
	type SubsystemContext,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type pm2 from "pm2";
import { AppManager } from "./core/app-manager.js";
import { BusManager } from "./core/bus-manager.js";
import { ProcessManager } from "./core/process-manager.js";
import "./monitor-commands.js";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import {
	type MonitorConfig,
	monitorConfigSchema,
	type ResolvedMonitorConfig,
} from "./monitor-config.js";
import { registerMonitorDashboardFeatures } from "./monitor-dashboard.js";
import { MonitorPluginDriver } from "./monitor-plugin.js";
import { MonitorStateManager } from "./monitor-state.js";

type MonitorActionContext = SubsystemContext & {
	processManager: ProcessManager;
	busManager: BusManager;
	appManager: AppManager;
	stateManager: MonitorStateManager;
	pluginDriver: MonitorPluginDriver;
	config: ResolvedMonitorConfig;
};

export function killPM2(logger: Omit<Logger, "child">): ResultAsync<void, Error> {
	logger.verbose("Killing existing PM2 daemon");
	return ProcessManager.kill().map(() => undefined);
}

function connect(ctx: MonitorActionContext, ensureDaemonOwnership = true) {
	ctx.eventBus.emit("monitor:connect:start", {});

	return ctx.pluginDriver
		.runHookSequential("beforeConnect")
		.andThen(() => ctx.busManager.disconnect())
		.andThen(() => ctx.processManager.isDaemonRunning())
		.andThen((isDaemonRunning) => {
			if (ensureDaemonOwnership && isDaemonRunning && ctx.config.deleteExistingBeforeConnect) {
				return killPM2(ctx.logger);
			}
			return okAsync(undefined);
		})
		.andThen(() => {
			ctx.logger.info("Connecting to PM2");
			return ctx.processManager.connect();
		})
		.andThen(() => ctx.busManager.connect())
		.andThrough(() => ctx.pluginDriver.runHookSequential("afterConnect"))
		.andTee(() => {
			ctx.stateManager.setConnected(true);
			ctx.eventBus.emit("monitor:connect:done", {});
		})
		.orElse((error) => {
			ctx.eventBus.emit("monitor:connect:error", { error });
			return errAsync(error);
		});
}

function disconnect(ctx: MonitorActionContext): ResultAsync<void, Error> {
	ctx.logger.info("Disconnecting from PM2");
	ctx.eventBus.emit("monitor:disconnect:start", {});

	return ctx.pluginDriver
		.runHookSequential("beforeDisconnect")
		.andThen(() => ctx.busManager.disconnect())
		.andThen(() => ctx.processManager.isDaemonRunning())
		.andThen((isDaemonRunning) => {
			if (isDaemonRunning) {
				ctx.logger.verbose("Disconnecting from daemon");
				return ctx.processManager.disconnect();
			}
			return okAsync(undefined);
		})
		.andThrough(() => ctx.pluginDriver.runHookSequential("afterDisconnect"))
		.andTee(() => {
			ctx.stateManager.setConnected(false);
			ctx.eventBus.emit("monitor:disconnect:done", {});
		});
}

function start(
	ctx: MonitorActionContext,
	appNames: string | string[] | null = null,
): ResultAsync<void, Error> {
	return ctx.processManager
		.isDaemonRunning()
		.andThen((isDaemonRunning) => {
			if (!isDaemonRunning) {
				return connect(ctx, false);
			}
			return okAsync(undefined);
		})
		.andThen(() => ctx.appManager.validateAppNames(appNames))
		.andThen((validatedNames) => {
			if (!validatedNames || validatedNames.length === 0) {
				ctx.logger.warn("No apps configured to start");
				return okAsync(undefined);
			}
			ctx.logger.info(`Starting app(s): ${validatedNames.join(", ")}`);

			return ResultAsync.combine(
				validatedNames.map((name) =>
					ctx.pluginDriver
						.runHookSequential("beforeAppStart", { appName: name })
						.andThen(() => ctx.appManager.startApp(name))
						.andThrough((process) => {
							ctx.stateManager.markAppStarted(name, process.pid, process.pm_id);
							return ctx.pluginDriver.runHookSequential("afterAppStart", {
								appName: name,
								process,
							});
						})
						.orElse((error) => {
							ctx.stateManager.markAppErrored(name);
							return errAsync(error);
						}),
				),
			).andThen(() => ctx.appManager.applyWindowSettings(validatedNames));
		});
}

function stop(
	ctx: MonitorActionContext,
	appNames: string | string[] | null = null,
): ResultAsync<void, Error> {
	return ctx.appManager.validateAppNames(appNames).asyncAndThen((validatedNames) => {
		ctx.logger.info(`Stopping app(s): ${validatedNames}`);

		if (!validatedNames || validatedNames.length === 0) {
			ctx.logger.warn("No apps configured to stop");
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			validatedNames.map((name) =>
				ctx.pluginDriver
					.runHookSequential("beforeAppStop", { appName: name })
					.andThen(() => ctx.appManager.stopApp(name))
					.andThrough(() => {
						ctx.stateManager.markAppStopped(name);
						return ctx.pluginDriver.runHookSequential("afterAppStop", { appName: name });
					}),
			),
		).map(() => undefined);
	});
}

function restart(
	ctx: MonitorActionContext,
	appNames: string | string[] | null = null,
): ResultAsync<void, Error> {
	return ctx.appManager
		.validateAppNames(appNames)
		.andTee((validatedNames) => {
			for (const appName of validatedNames) {
				ctx.eventBus.emit("monitor:app:restart", { appName });
			}
		})
		.asyncAndThrough(() => stop(ctx, appNames))
		.andThrough(() => start(ctx, appNames))
		.andTee((validatedNames) => {
			for (const appName of validatedNames) {
				ctx.appManager.getAppProcess(appName, true).match(
					(process: pm2.ProcessDescription) => {
						const pm2Id = process.pm_id;
						if (pm2Id !== undefined && process.pid !== undefined) {
							ctx.eventBus.emit("monitor:app:restarted", {
								appName,
								pm2Id,
								pid: process.pid,
							});
						}
					},
					() => {
						// Ignore errors when getting process info for event
					},
				);
			}
		})
		.andThen(() => okAsync(undefined));
}

function shutdown(
	ctx: MonitorActionContext,
	eventOrExitCode: number | undefined = undefined,
): ResultAsync<void, Error> {
	ctx.logger.info("Monitor exiting... 👋");

	return ctx.pluginDriver
		.runHookSequential("beforeShutdown", { code: eventOrExitCode })
		.andThen(() => stop(ctx))
		.andThen(() => disconnect(ctx))
		.andTee(() => {
			ctx.logger.info("...apps stopped ✋");
			ctx.logger.info("...monitor shut down");

			process.exit(
				eventOrExitCode === undefined || Number.isNaN(+eventOrExitCode) ? 1 : +eventOrExitCode,
			);
		})
		.mapErr((error) => {
			ctx.logger.error("Unhandled exit exception:", error);
			return error;
		});
}

/**
 * Creates a LaunchpadMonitor subsystem factory.
 * Call setup() on the returned object to initialize the monitor.
 */
export function createLaunchpadMonitor(config: MonitorConfig) {
	return defineSubsystem({
		name: "monitor",
		setup(ctx: SubsystemContext) {
			const configResult = monitorConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(new Error("Invalid monitor configuration", { cause: configResult.error }));
			}
			const resolvedConfig = configResult.data;

			// initialize persistent services
			const processManager = new ProcessManager(ctx.logger);
			const busManager = new BusManager(ctx.logger);
			const appManager = new AppManager(ctx.logger, processManager, resolvedConfig, ctx.cwd);
			const stateManager = new MonitorStateManager();

			// Initialize app states
			for (const appConf of resolvedConfig.apps) {
				if (appConf.pm2.name) stateManager.initializeApp(appConf.pm2.name);
				busManager.initAppLogging(appConf);
			}

			const basePluginDriver = new PluginDriver(ctx, resolvedConfig.plugins);
			const pluginDriver = new MonitorPluginDriver(basePluginDriver, {
				busManager,
			});

			const actionCtx: MonitorActionContext = {
				...ctx,
				processManager,
				busManager,
				appManager,
				stateManager,
				pluginDriver,
				config: resolvedConfig,
			};

			return okAsync({
				executeCommand(command: AnyCommand) {
					switch (command.type) {
						case "monitor.connect":
							return connect(actionCtx, command.ensureDaemonOwnership ?? true);
						case "monitor.disconnect":
							return disconnect(actionCtx);
						case "monitor.start":
							return stateManager.acquireAppActionLock(command.appNames, "starting", () =>
								start(actionCtx, command.appNames),
							);
						case "monitor.stop":
							return stateManager.acquireAppActionLock(command.appNames, "stopping", () =>
								stop(actionCtx, command.appNames),
							);
						case "monitor.restart":
							return stateManager.acquireAppActionLock(command.appNames, "restarting", () =>
								restart(actionCtx, command.appNames),
							);
						case "monitor.shutdown":
							return shutdown(actionCtx, command.exitCode);
						default: {
							return errAsync(
								new Error(`Unknown monitor command type: ${(command as AnyCommand).type}`),
							);
						}
					}
				},
				getState() {
					return stateManager.state;
				},
				onStatePatch(handler: PatchHandler) {
					return stateManager.onPatch(handler);
				},
				disconnect() {
					return shutdown(actionCtx);
				},
				buildDashboard(registry: DashboardRegistry) {
					return registerMonitorDashboardFeatures(registry, stateManager, ctx.dispatchCommand);
				},
			});
		},
	});
}
