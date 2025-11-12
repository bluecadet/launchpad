import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { SubEmitterSocket } from "axon";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import pm2 from "pm2";
import { Tail } from "tail";
import { LogModes, type ResolvedAppConfig } from "../monitor-config.js";

export class BusManager {
	#logger: Logger;
	#appLoggers: Map<string, Logger> = new Map();
	#bus: SubEmitterSocket | null = null;
	#eventHandlers: Set<(eventType: string, eventData: unknown) => void> = new Set();
	#outTails: Map<string, Tail> = new Map();
	#errTails: Map<string, Tail> = new Map();
	#appConfigs: Map<string, ResolvedAppConfig> = new Map();

	constructor(logger: Logger) {
		this.#logger = logger;
	}

	initAppLogging(appConfig: ResolvedAppConfig) {
		const appName = appConfig.pm2.name;
		if (!appName) {
			this.#logger.error("App config is missing name:", appConfig);
			return;
		}

		this.#appLoggers.set(appName, this.#logger.child(appName));
		this.#appConfigs.set(appName, appConfig);

		if (appConfig.logging.mode === LogModes.file) {
			this._setupFileTailing(appConfig);
		}
	}

	_setupFileTailing(appConfig: ResolvedAppConfig) {
		const appName = appConfig.pm2.name;
		if (!appName) return;

		const outFilepath = appConfig.pm2.output;
		const errFilepath = appConfig.pm2.error;

		const tailOptions = {
			useWatchFile: true,
			fsWatchOptions: { interval: 100 },
		};

		if (outFilepath && appConfig.logging.showStdout) {
			this.#logger.debug(`Tailing stdout from ${outFilepath}`);
			const outTail = new Tail(outFilepath, tailOptions);
			outTail.on("line", (data) => {
				if (typeof data === "string") {
					this.#handleTailOutput(appName, data);
				}
			});
			outTail.on("error", (data) => {
				if (typeof data === "string") {
					this.#handleTailError(appName, data, true);
				}
			});
			outTail.watch();
			this.#outTails.set(appName, outTail);
		}

		if (errFilepath && appConfig.logging.showStderr) {
			this.#logger.debug(`Tailing stderr from ${errFilepath}`);
			const errTail = new Tail(errFilepath, tailOptions);
			errTail.on("line", (data) => {
				if (typeof data === "string") {
					this.#handleTailError(appName, data);
				}
			});
			errTail.on("error", (data) => {
				if (typeof data === "string") {
					this.#handleTailError(appName, data, true);
				}
			});
			errTail.watch();
			this.#errTails.set(appName, errTail);
		}
	}

	connect(): ResultAsync<void, Error> {
		this.#logger.debug("Connecting to PM2 bus");

		return ResultAsync.fromPromise(
			new Promise((resolve, reject) => {
				pm2.launchBus((err, bus) => {
					if (err) reject(err);
					else resolve(bus);
				});
			}).then((bus) => {
				this.#bus = bus as SubEmitterSocket;
				if (this.#bus) {
					this.#bus.on("*", this.#handleBusEvent.bind(this));
					return;
				}
				throw new Error("Failed to connect to PM2 bus");
			}),
			(error) =>
				error instanceof Error ? error : new Error("Unknown error connecting to PM2 bus"),
		);
	}

	disconnect(): Result<void, Error> {
		try {
			if (this.#bus) {
				this.#logger.debug("Disconnecting from PM2 bus");
				this.#bus.off("*");
				this.#bus = null;
			}

			// Clean up file tails
			for (const [appName, tail] of this.#outTails) {
				tail.unwatch();
				this.#outTails.delete(appName);
				this.#appLoggers.delete(appName);
			}
			for (const [appName, tail] of this.#errTails) {
				tail.unwatch();
				this.#errTails.delete(appName);
			}
			return ok(undefined);
		} catch (error) {
			return err(
				error instanceof Error ? error : new Error("Unknown error disconnecting from PM2 bus"),
			);
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: probably should be unknown
	addEventHandler(handler: (eventType: string, eventData: any) => void) {
		this.#eventHandlers.add(handler);
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: probably should be unknown
	removeEventHandler(handler: (eventType: string, eventData: any) => void) {
		this.#eventHandlers.delete(handler);
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: probably should be unknown
	#handleBusEvent(eventType: string, eventData: any) {
		try {
			if (!eventData?.process?.name) {
				return;
			}

			const appName = eventData.process.name;
			const appConfig = this.#appConfigs.get(appName);

			if (!appConfig) {
				return;
			}

			// Handle process events
			if (eventType === "process:event") {
				if (eventData.event === "online") {
					this.#handleProcessOnline(appName);
				} else if (eventData.event === "exit") {
					this.#handleProcessExit(appName);
				}
			}

			// Handle log events for bus mode
			if (appConfig.logging.mode === LogModes.bus) {
				if (eventType === "log:out" && appConfig.logging.showStdout) {
					this.#handleBusLogOut(appName, eventData);
				} else if (eventType === "log:err" && appConfig.logging.showStderr) {
					this.#handleBusLogErr(appName, eventData);
				}
			}

			// Notify other handlers
			for (const handler of this.#eventHandlers) {
				handler(eventType, eventData);
			}
		} catch (error) {
			this.#logger.error("Error handling bus event:", error);
		}
	}

	#handleProcessOnline(appName: string) {
		const appConfig = this.#appConfigs.get(appName);
		if (appConfig?.logging.mode === LogModes.file) {
			this._setupFileTailing(appConfig);
		}
	}

	#handleProcessExit(appName: string) {
		const outTail = this.#outTails.get(appName);
		if (outTail) {
			outTail.unwatch();
			this.#outTails.delete(appName);
		}

		const errTail = this.#errTails.get(appName);
		if (errTail) {
			errTail.unwatch();
			this.#errTails.delete(appName);
		}
	}

	#handleTailOutput(appName: string, data: string) {
		const appLogger = this.#appLoggers.get(appName);
		if (!appLogger) return;
		appLogger.info(data);
	}

	#handleTailError(appName: string, data: string, _isTailError = false) {
		const appLogger = this.#appLoggers.get(appName);
		if (!appLogger) return;
		appLogger.error(data);
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: probably should be unknown
	#handleBusLogOut(appName: string, event: any) {
		const appLogger = this.#appLoggers.get(appName);
		if (!appLogger) return;
		for (const line of this.#splitLines(event.data.toString())) {
			appLogger.info(line);
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: probably should be unknown
	#handleBusLogErr(appName: string, event: any) {
		const appLogger = this.#appLoggers.get(appName);
		if (!appLogger) return;
		for (const line of this.#splitLines(event.data.toString())) {
			appLogger.error(line);
		}
	}

	#splitLines(buffer: string) {
		const parts = buffer.split(/[\r]{0,1}\n/);
		parts.pop(); // last item will always be an empty string because every line ends with a carriage return
		return parts;
	}
}
