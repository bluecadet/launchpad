import { LogManager, type Logger, onExit } from "@bluecadet/launchpad-utils";
import { PluginDriver } from "@bluecadet/launchpad-utils";
import autoBind from "auto-bind";
import { spawn } from "cross-spawn";
import { ResultAsync, okAsync } from "neverthrow";
import type pm2 from "pm2";
import { AppManager } from "./core/app-manager.js";
import { BusManager } from "./core/bus-manager.js";
import { MonitorPluginDriver } from "./core/monitor-plugin-driver.js";
import { ProcessManager } from "./core/process-manager.js";
import {
	type MonitorConfig,
	type ResolvedMonitorConfig,
	monitorConfigSchema,
} from "./monitor-config.js";

class LaunchpadMonitor {
	_config: ResolvedMonitorConfig;
	_logger: Logger;
	_processManager: ProcessManager;
	_busManager: BusManager;
	_appManager: AppManager;
	_pluginDriver: MonitorPluginDriver;
	_isShuttingDown = false;

	constructor(config: MonitorConfig, parentLogger: Logger) {
		autoBind(this);
		this._logger = LogManager.getLogger("monitor", parentLogger);
		this._config = monitorConfigSchema.parse(config);

		this._processManager = new ProcessManager(this._logger);
		this._busManager = new BusManager(this._logger);
		this._appManager = new AppManager(this._logger, this._processManager, this._config);

		for (const appConf of this._config.apps) {
			this._busManager.initAppLogging(appConf);
		}

		if (this._config.shutdownOnExit) {
			onExit(() => {
				this.shutdown();
			});
		}

		const basePluginDriver = new PluginDriver(this._logger, this._config.plugins);
		this._pluginDriver = new MonitorPluginDriver(basePluginDriver, { monitor: this });
	}

	/**
	 * Checks if we're currently connected to PM2.
	 */
	isConnected(): ResultAsync<boolean, Error> {
		return this._processManager.isDaemonRunning();
	}

	/**
	 * Connects to the PM2 daemon and tails all logs.
	 * Call this before starting any apps.
	 *
	 * @param ensureDaemonOwnership This will kill the existing PM2 daemon if it's already running.
	 */
	connect(ensureDaemonOwnership = true): ResultAsync<void, Error> {
		return this._pluginDriver
			.runHookSequential("beforeConnect")
			.andThen(() => this._busManager.disconnect())
			.andThen(() => this._processManager.isDaemonRunning())
			.andThen((isDaemonRunning) => {
				if (ensureDaemonOwnership && isDaemonRunning) {
					return this._handleExistingDaemon();
				}
				return okAsync(undefined);
			})
			.andThen(() => {
				this._logger.info("Connecting to PM2");
				return this._processManager.connect();
			})
			.andThen(() => {
				return this._busManager.connect();
			})
			.andThrough(() => this._pluginDriver.runHookSequential("afterConnect"));
	}

	/**
	 * @internal
	 */
	_handleExistingDaemon(): ResultAsync<void, Error> {
		if (this._config.deleteExistingBeforeConnect) {
			this._logger.debug("Deleting existing PM2 processes");
			return this._processManager.deleteAllProcesses().andThen(() => {
				this._logger.debug("Killing existing PM2 daemon");
				return LaunchpadMonitor.kill(this._logger);
			});
		}
		return okAsync(undefined);
	}

	/**
	 * Disconnects from the PM2 daemon and stops tailing all logs.
	 */
	disconnect(): ResultAsync<void, Error> {
		this._logger.info("Disconnecting from PM2");

		return this._pluginDriver
			.runHookSequential("beforeDisconnect")
			.andThen(() => this._busManager.disconnect())
			.andThen(() => this._processManager.isDaemonRunning())
			.andThen((isDaemonRunning) => {
				if (isDaemonRunning) {
					this._logger.debug("Disconnecting from daemon");
					return this._processManager.disconnect();
				}
				return okAsync(undefined);
			})
			.andThrough(() => this._pluginDriver.runHookSequential("afterDisconnect"));
	}

	/**
	 * Starts an app or a list of apps. Will connect to PM2 if not connected previously.
	 * @param appNames Single app name, array of app names or null/undefined to default to all apps.
	 */
	start(appNames: string | string[] | null = null): ResultAsync<void, Error> {
		return this._processManager
			.isDaemonRunning()
			.andThen((isDaemonRunning) => {
				if (!isDaemonRunning) {
					return this.connect();
				}
				return okAsync(undefined);
			})
			.andThen(() => this._appManager.validateAppNames(appNames))
			.andThen((validatedNames) => {
				if (!validatedNames || validatedNames.length === 0) {
					this._logger.warn("No apps configured to start");
					return okAsync(undefined);
				}
				this._logger.info(`Starting app(s): ${validatedNames.join(", ")}`);

				return ResultAsync.combine(
					validatedNames.map((name) =>
						this._pluginDriver
							.runHookSequential("beforeAppStart", { appName: name })
							.andThen(() => this._appManager.startApp(name))
							.andThrough((process) =>
								this._pluginDriver.runHookSequential("afterAppStart", { appName: name, process }),
							),
					),
				).andThen(() => this._appManager.applyWindowSettings(validatedNames));
			});
	}

	/**
	 * Stops an app or a list of apps.
	 * @param appNames Single app name, array of app names or null/undefined to default to all apps.
	 */
	stop(appNames: string | string[] | null = null): ResultAsync<void, Error> {
		return this._appManager.validateAppNames(appNames).asyncAndThen((validatedNames) => {
			this._logger.info(`Stopping app(s): ${validatedNames}`);

			if (!validatedNames || validatedNames.length === 0) {
				this._logger.warn("No apps configured to stop");
				return okAsync(undefined);
			}

			return ResultAsync.combine(
				validatedNames.map((name) =>
					this._pluginDriver
						.runHookSequential("beforeAppStop", { appName: name })
						.andThen(() => this._appManager.stopApp(name))
						.andThrough(() =>
							this._pluginDriver.runHookSequential("afterAppStop", { appName: name }),
						),
				),
			).map(() => undefined);
		});
	}

	/**
	 * Checks if any of these apps are currently running.
	 * @param appNames Single app name, array of app names or null/undefined to default to all apps.
	 */
	isRunning(appNames: string | string[] | null = null): ResultAsync<boolean, Error> {
		return this._appManager
			.validateAppNames(appNames)
			.asyncAndThen((validatedNames) => {
				return ResultAsync.combine(
					validatedNames.map((name) => this._appManager.isAppRunning(name, true)),
				);
			})
			.map((results) => results.some((isRunning) => isRunning));
	}

	/**
	 * Gets the info of a running process
	 * @param {string} appName The name of the app/process
	 * @param {boolean} silent Disables warnings when processes can't be found.
	 */
	getAppProcess(appName: string, silent = false): ResultAsync<pm2.ProcessDescription, Error> {
		return this._processManager.getProcess(appName, silent);
	}

	/**
	 * Stops launchpad and exits this process.
	 */
	shutdown(eventOrExitCode: number | undefined = undefined): ResultAsync<void, Error> {
		this._logger.info("Monitor exiting... 👋");

		if (this._isShuttingDown) {
			this._logger.warn("Aborting exit since launchpad is already exiting");
			return okAsync(undefined);
		}

		this._isShuttingDown = true;

		return this._pluginDriver
			.runHookSequential("beforeShutdown", { code: eventOrExitCode })
			.andThen(() => this.stop())
			.andThen(() => this.disconnect())
			.andTee(() => {
				this._logger.info("...apps stopped ✋");
				this._logger.info("...monitor shut down");
				this._logger.close();

				process.exit(
					eventOrExitCode === undefined || Number.isNaN(+eventOrExitCode) ? 1 : +eventOrExitCode,
				);
			})
			.mapErr((error) => {
				this._logger.error("Unhandled exit exception:", error);
				return error;
			});
	}

	/**
	 * Force kills all PM2 instances
	 */
	static kill(logger: Logger): ResultAsync<void, Error> {
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
}

export default LaunchpadMonitor;
