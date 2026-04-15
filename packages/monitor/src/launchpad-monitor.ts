import { SingleCommandGuard } from "@bluecadet/launchpad-utils/command-guard";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { spawn } from "cross-spawn";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type pm2 from "pm2";
import { AppManager } from "./core/app-manager.js";
import { BusManager } from "./core/bus-manager.js";
import { ProcessManager } from "./core/process-manager.js";
import { MonitorError } from "./errors.js";
import { type MonitorCommand, monitorCommandSchema } from "./monitor-commands.js";
import {
	type MonitorConfig,
	monitorConfigSchema,
	type ResolvedMonitorConfig,
} from "./monitor-config.js";
import { monitorPanel } from "./monitor-panel.js";
import { type MonitorState, MonitorStateManager } from "./monitor-state.js";
import { monitorStatusSection } from "./monitor-status-section.js";

type MonitorActionContext = PluginContext<MonitorState> & {
	processManager: ProcessManager;
	busManager: BusManager;
	appManager: AppManager;
	stateManager: MonitorStateManager;
	config: ResolvedMonitorConfig;
};

/**
 * Force kills all PM2 instances
 */
export function killPM2(logger: Omit<Logger, "child">): ResultAsync<void, Error> {
	return ResultAsync.fromPromise(
		new Promise((resolve, reject) => {
			const child = spawn("npm", ["exec", "pm2", "kill"], { shell: true });

			child.stdout.on("data", (data) => logger.info(data));
			child.stderr.on("data", (data) => logger.error(data));

			child.on("error", (error) => {
				logger.error(`PM2 could not be killed: ${error}`);
				reject(error);
			});

			child.on("close", () => {
				logger.info("PM2 has been killed");
				resolve(undefined);
			});
		}),
		(error) => new Error("Failed to kill PM2", { cause: error }),
	);
}

function _handleExistingDaemon(
	resolvedConfig: ResolvedMonitorConfig,
	ctx: MonitorActionContext,
	processManager: ProcessManager,
): ResultAsync<void, Error> {
	if (resolvedConfig.deleteExistingBeforeConnect) {
		ctx.logger.verbose("Deleting existing PM2 processes");
		return processManager.deleteAllProcesses().andThen(() => {
			ctx.logger.verbose("Killing existing PM2 daemon");
			return killPM2(ctx.logger);
		});
	}
	return okAsync(undefined);
}

function connect(ctx: MonitorActionContext, ensureDaemonOwnership = true) {
	ctx.eventBus.emit("monitor:connect:start", {});

	return ctx.busManager
		.disconnect()
		.asyncAndThen(() => ctx.processManager.isDaemonRunning())
		.andThen((isDaemonRunning) => {
			if (ensureDaemonOwnership && isDaemonRunning) {
				return _handleExistingDaemon(ctx.config, ctx, ctx.processManager);
			}
			return okAsync(undefined);
		})
		.andThen(() => {
			ctx.logger.info("Connecting to PM2");
			return ctx.processManager.connect();
		})
		.andThen(() => ctx.busManager.connect())
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

	return ctx.busManager
		.disconnect()
		.asyncAndThen(() => ctx.processManager.isDaemonRunning())
		.andThen((isDaemonRunning) => {
			if (isDaemonRunning) {
				ctx.logger.verbose("Disconnecting from daemon");
				return ctx.processManager.disconnect();
			}
			return okAsync(undefined);
		})
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
					ctx.appManager
						.startApp(name)
						.andThrough((process) => {
							ctx.stateManager.markAppStarted(name, process.pid, process.pm_id);
							return okAsync(undefined);
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
				ctx.appManager.stopApp(name).andThrough(() => {
					ctx.stateManager.markAppStopped(name);
					return okAsync(undefined);
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

	ctx.eventBus.emit("monitor:beforeShutdown", { code: eventOrExitCode });

	return stop(ctx)
		.andThen(() => disconnect(ctx))
		.andTee(() => {
			ctx.logger.info("...apps stopped ✋");
			ctx.logger.info("...monitor shut down");
		})
		.mapErr((error) => {
			ctx.logger.error("Unhandled exit exception:", error);
			return error;
		});
}

/**
 * Creates a LaunchpadMonitor plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function monitor(config: MonitorConfig) {
	return definePlugin({
		name: "monitor",
		manifest: {
			commands: [
				{ id: "monitor.connect", parser: monitorCommandSchema },
				{ id: "monitor.disconnect", parser: monitorCommandSchema },
				{ id: "monitor.start", parser: monitorCommandSchema },
				{ id: "monitor.stop", parser: monitorCommandSchema },
				{ id: "monitor.restart", parser: monitorCommandSchema },
				{ id: "monitor.shutdown", parser: monitorCommandSchema },
			],
		},
		setup(ctx: PluginContext<MonitorState>) {
			ctx.statusRegistry.contributeStatusSection(monitorStatusSection);
			const configResult = monitorConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(new Error("Invalid monitor configuration", { cause: configResult.error }));
			}
			const resolvedConfig = configResult.data;

			ctx.dashboardRegistry.contributePanel(monitorPanel);

			// initialize persistent services
			const processManager = new ProcessManager(ctx.logger);
			const busManager = new BusManager(ctx.logger);
			const appManager = new AppManager(ctx.logger, processManager, resolvedConfig, ctx.cwd);
			const stateManager = new MonitorStateManager(ctx.updateState);

			// Initialize app states
			for (const appConf of resolvedConfig.apps) {
				if (appConf.pm2.name) stateManager.initializeApp(appConf.pm2.name);
				busManager.initAppLogging(appConf);
			}

			const actionCtx: MonitorActionContext = {
				...ctx,
				processManager,
				busManager,
				appManager,
				stateManager,
				config: resolvedConfig,
			};

			// Route PM2 bus events to the event bus
			busManager.addEventHandler((eventType, eventData) => {
				if (!eventData?.process?.name) return;
				const appName = eventData.process.name;

				if (eventType === "log:out") {
					ctx.eventBus.emit("monitor:app:log", {
						appName,
						data: eventData.data?.toString() ?? "",
					});
				}
				if (eventType === "log:err") {
					ctx.eventBus.emit("monitor:app:errorLog", {
						appName,
						data: eventData.data?.toString() ?? "",
					});
				}
				if (eventType === "process:event") {
					if (eventData.event === "error" || eventData.event === "exception") {
						ctx.eventBus.emit("monitor:app:error", {
							appName,
							error: new Error(eventData.data || "Unknown error"),
						});
					}
				}
			});

			const commandGuard = new SingleCommandGuard();

			return okAsync({
				executeCommand(command: MonitorCommand): ResultAsync<void, Error> {
					const parsed = monitorCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new MonitorError(`Invalid command: ${parsed.error.message}`));
					}

					const validCommand = parsed.data;

					switch (validCommand.type) {
						case "monitor.connect":
							return commandGuard.run(() =>
								connect(actionCtx, validCommand.ensureDaemonOwnership ?? true),
							);
						case "monitor.disconnect":
							return commandGuard.run(() => disconnect(actionCtx));
						case "monitor.start":
							return commandGuard.run(() => start(actionCtx, validCommand.appNames));
						case "monitor.stop":
							return commandGuard.run(() => stop(actionCtx, validCommand.appNames));
						case "monitor.restart":
							return commandGuard.run(() => restart(actionCtx, validCommand.appNames));
						case "monitor.shutdown":
							return commandGuard.run(() => shutdown(actionCtx, validCommand.exitCode));
						default: {
							return errAsync(new MonitorError("Unknown monitor command type"));
						}
					}
				},
				disconnect() {
					return disconnect(actionCtx);
				},
			});
		},
	});
}
