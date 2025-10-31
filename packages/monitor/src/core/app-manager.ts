import path from "node:path";
import type { EventBus } from "@bluecadet/launchpad-utils/controller-interfaces";
import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import type pm2 from "pm2";
import type { ResolvedAppConfig, ResolvedMonitorConfig } from "../monitor-config.js";
import { debounceResultAsync } from "../utils/debounce-results.js";
import sortWindows from "../utils/sort-windows.js";
import type { ProcessManager } from "./process-manager.js";

export class AppManager {
	#logger: Logger;
	#processManager: ProcessManager;
	#config: ResolvedMonitorConfig;
	#cwd: string;
	#eventBus?: EventBus;

	constructor(
		logger: Logger,
		processManager: ProcessManager,
		config: ResolvedMonitorConfig,
		cwd: string = process.cwd(),
	) {
		this.#logger = logger;
		this.#processManager = processManager;
		this.#config = config;
		this.#cwd = cwd;

		this.applyWindowSettings = debounceResultAsync(
			this.applyWindowSettings.bind(this),
			this.#config.windowsApi.debounceDelay,
		);
	}

	setEventBus(eventBus: EventBus): void {
		this.#eventBus = eventBus;
	}

	startApp(appName: string): ResultAsync<pm2.ProcessDescription, Error> {
		this.#logger.info(`Starting app '${appName}'...`);

		// Emit start event
		this.#eventBus?.emit("monitor:app:start", {
			appName,
		});

		return this.getAppOptions(appName)
			.asyncAndThen((opts) => {
				// @ts-expect-error - Undocumented PM2 field that can prevent your apps from actually showing on launch. Set this to false to prevent that default behavior.
				opts.pm2.windowsHide = opts.windows.hide;
				return this.#processManager.startProcess(opts.pm2);
			})
			.andThen(() => this.#processManager.getProcess(appName))
			.andTee((process) => {
				this.#logger.info(`...app '${appName}' was started.`);

				// Emit started event with process info
				const pm2Id = process.pm_id;
				if (pm2Id !== undefined && process.pid !== undefined) {
					this.#eventBus?.emit("monitor:app:started", {
						appName,
						pm2Id,
						pid: process.pid,
					});
				}
			})
			.orElse((error) => {
				// Emit error event
				this.#eventBus?.emit("monitor:app:error", {
					appName,
					error,
					operation: "start",
				});
				return errAsync(error);
			});
	}

	stopApp(appName: string): ResultAsync<pm2.ProcessDescription, Error> {
		this.#logger.info(`Stopping app '${appName}'...`);

		// Emit stop event
		this.#eventBus?.emit("monitor:app:stop", {
			appName,
		});

		return this.#processManager
			.stopProcess(appName)
			.andTee((process) => {
				this.#logger.info(`...app '${appName}' was stopped.`);

				// Emit stopped event with process info
				const pm2Id = process.pm_id;
				if (pm2Id !== undefined) {
					this.#eventBus?.emit("monitor:app:stopped", {
						appName,
						pm2Id,
					});
				}
			})
			.orElse((error) => {
				// Emit error event
				this.#eventBus?.emit("monitor:app:error", {
					appName,
					error,
					operation: "stop",
				});
				return errAsync(error);
			});
	}

	isAppRunning(appName: string, silent = true): ResultAsync<boolean, Error> {
		return this.#processManager
			.getProcess(appName, silent)
			.map((process) => process?.pm2_env?.status === "online")
			.orElse(() => okAsync(false));
	}

	getAppProcess(appName: string, silent = false): ResultAsync<pm2.ProcessDescription, Error> {
		return this.#processManager.getProcess(appName, silent);
	}

	validateAppNames(appNames: string | string[] | null = null): Result<string[], Error> {
		if (appNames === null || appNames === undefined) {
			return ok(this.getAllAppNames());
		}
		if (typeof appNames === "string") {
			return ok([appNames]);
		}
		if (Symbol.iterator in Object(appNames)) {
			return ok([...appNames]);
		}
		return err(
			new Error("appNames must be null, undefined, a string or an iterable array/set of strings"),
		);
	}

	getAllAppNames() {
		if ("apps" in this.#config) {
			return this.#config.apps.map((app) => app.pm2.name).filter((name) => name !== undefined);
		}
		return [];
	}

	getAppOptions(appName: string): Result<ResolvedAppConfig, Error> {
		const options = this.#config.apps.find((app) => app.pm2.name === appName);
		if (!options) {
			return err(new Error(`No app found with the name '${appName}'`));
		}
		return ok(this.#updateConfigCWD(options));
	}

	#updateConfigCWD(appConfig: ResolvedAppConfig): ResolvedAppConfig {
		return {
			...appConfig,
			pm2: {
				...appConfig.pm2,
				// Ensure the cwd is resolved relative to the manager's cwd
				cwd: appConfig.pm2.cwd ? path.resolve(this.#cwd, appConfig.pm2.cwd) : undefined,
			},
		};
	}

	applyWindowSettings(appNames: string[] = []): ResultAsync<void, Error> {
		const validatedAppNames = this.validateAppNames(appNames);

		if (validatedAppNames.isErr()) {
			return errAsync(validatedAppNames.error);
		}

		const appResults = validatedAppNames.value.map((appName) => {
			const appOptions = this.getAppOptions(appName);

			if (appOptions.isErr()) {
				return errAsync(appOptions.error);
			}

			return this.#processManager.getProcess(appName).andThen((process) => {
				if (process.pid !== undefined) {
					return ok({
						options: appOptions.value,
						pid: process.pid,
					});
				}
				return err(new Error(`No process found for app ${appName}`));
			});
		});

		return ResultAsync.combine(appResults).andThen((apps) => {
			return ResultAsync.fromPromise(
				sortWindows(apps, this.#logger),
				(e) => new Error("Failed to sort windows", { cause: e }),
			);
		});
	}
}
