import type { Logger } from "@bluecadet/launchpad-utils";
import { ok, err, ResultAsync, okAsync, Result } from "neverthrow";
import pm2 from "pm2";

export class ProcessManager {
	#logger: Logger;

	constructor(logger: Logger) {
		this.#logger = logger;
	}

	connect(): ResultAsync<void, Error> {
		return wrapPm2Function("Failed to connect to PM2", (cb) => pm2.connect(true, cb));
	}

	disconnect(): Result<void, Error> {
		return safeDisconnect();
	}

	isDaemonRunning(): ResultAsync<boolean, Error> {
		this.#logger.debug("Checking if daemon is running...");
		return pingDaemon();
	}

	getProcess(appName: string, silent = false): ResultAsync<pm2.ProcessDescription, Error> {
		return this.getProcesses().andThen((processes) => {
			const process = processes.find((p) => p.name === appName);
			if (!process) {
				if (!silent) {
					this.#logger.warn(`No process found with name '${appName}'`);
				}
				return err(new Error(`No process found with name '${appName}'`));
			}
			return ok(process);
		});
	}

	getProcesses(): ResultAsync<pm2.ProcessDescription[], Error> {
		return wrapPm2Function("Failed to get PM2 processes", pm2.list);
	}

	startProcess(options: pm2.StartOptions): ResultAsync<pm2.ProcessDescription, Error> {
		return wrapPm2Function("Failed to start PM2", (cb) => pm2.start(options, cb));
	}

	stopProcess(processName: string): ResultAsync<pm2.ProcessDescription, Error> {
		return wrapPm2Function("Failed to stop PM2", (cb) => pm2.stop(processName, cb));
	}

	deleteProcess(processName: string): ResultAsync<pm2.ProcessDescription, Error> {
		return wrapPm2Function("Failed to delete PM2 process", (cb) => pm2.delete(processName, cb));
	}

	deleteAllProcesses(): ResultAsync<void, Error> {
		return this.getProcesses().andThen((processes) => {
			const deletePromises = processes.map((process) => {
				if (process.name) {
					this.#logger.debug(`Deleting process ${process.name}`);
					return this.deleteProcess(process.name);
				}
				return okAsync(undefined);
			});

			return ResultAsync.combine(deletePromises).map(() => undefined);
		});
	}
}

function wrapPm2Function<T>(errorMessage: string, pmFunction: (cb: (err: Error | null, result?: T) => void) => void): ResultAsync<T, Error> {
	return ResultAsync.fromPromise(
		new Promise((resolve, reject) => {
			pmFunction((err, result) => {
				if (err) {
					reject(err);
				} else {
					// @ts-expect-error Some PM2 functions legitimately return undefined
					resolve(result);
				}
			});
		}),
		(error) => new Error(errorMessage, { cause: error }),
	);
}

const safeDisconnect = Result.fromThrowable(pm2.disconnect, (error) => new Error("Failed to disconnect from PM2", { cause: error }));

function pingDaemon(): ResultAsync<boolean, Error> {
	return ResultAsync.fromPromise(
		new Promise((resolve, reject) => {
			try {
				// @ts-expect-error - Private API as of 1/17/2022 -> could break
				pm2.Client.pingDaemon(resolve);
			} catch (err) {
				reject(err);
			}
		}),
		(error) => new Error("Failed to ping PM2 daemon", { cause: error }),
	);
}
