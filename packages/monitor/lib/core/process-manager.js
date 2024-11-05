import { ok, err, ResultAsync, okAsync, Result } from 'neverthrow';
import pm2 from 'pm2';

export class ProcessManager {
	/**
   * @private
   * @type {import('@bluecadet/launchpad-utils').Logger}
   */
	_logger;

	/**
   * @param {import('@bluecadet/launchpad-utils').Logger} logger
   */
	constructor(logger) {
		this._logger = logger;
	}

	/**
   * @returns {ResultAsync<void, Error>}
   */
	connect() {
		return wrapPm2Function(
			'Failed to connect to PM2',
			(cb) => pm2.connect(true, cb)
		);
	}

	/**
   * @returns {Result<void, Error>}
   */
	disconnect() {
		return safeDisconnect();
	}

	/**
   * @returns {ResultAsync<boolean, Error>}
   */
	isDaemonRunning() {
		this._logger.debug('Checking if daemon is running...');
		return pingDaemon();
	}

	/**
   * @param {string} appName
   * @param {boolean} silent
   * @returns {ResultAsync<import('pm2').ProcessDescription, Error>}
   */
	getProcess(appName, silent = false) {
		return this.getProcesses().andThen(processes => {
			const process = processes.find(p => p.name === appName);
			if (!process) {
				if (!silent) {
					this._logger.warn(`No process found with name '${appName}'`);
				}
				return err(new Error(`No process found with name '${appName}'`));
			}
			return ok(process);
		});
	}

	/**
   * @returns {ResultAsync<import('pm2').ProcessDescription[], Error>}
   */
	getProcesses() {
		return wrapPm2Function(
			'Failed to get PM2 processes',
			pm2.list
		);
	}

	/**
   * @param {import('pm2').StartOptions} options
   * @returns {ResultAsync<import('pm2').ProcessDescription, Error>}
   */
	startProcess(options) {
		return wrapPm2Function(
			'Failed to start PM2',
			(cb) => pm2.start(options, cb)
		);
	}

	/**
   * @param {string} processName
   * @returns {ResultAsync<import('pm2').Proc, Error>}
   */
	stopProcess(processName) {
		return wrapPm2Function(
			'Failed to stop PM2',
			(cb) => pm2.stop(processName, cb)
		);
	}

	/**
   * @param {string} processName
   * @returns {ResultAsync<import('pm2').Proc, Error>}
   */
	deleteProcess(processName) {
		return wrapPm2Function(
			'Failed to delete PM2 process',
			(cb) => pm2.delete(processName, cb)
		);
	}

	/**
   * Delete all PM2 processes
   * @returns {ResultAsync<void, Error>}
   */
	deleteAllProcesses() {
		return this.getProcesses()
			.andThen(processes => {
				const deletePromises = processes
					.map(process => {
						if (process.name) {
							this._logger.debug(`Deleting process ${process.name}`);
							return this.deleteProcess(process.name);
						}
						return okAsync(undefined);
					});

				return ResultAsync.combine(deletePromises).map(() => undefined);
			});
	}
}

/**
 * @template T
 * @param {string} errorMessage
 * @param {(cb: (err: Error | null, result?: T) => void) => void} pmFunction 
 * @returns {ResultAsync<T, Error>}
 */
function wrapPm2Function(errorMessage, pmFunction) {
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
		(error) => new Error(errorMessage, { cause: error })
	);
}

const safeDisconnect = Result.fromThrowable(pm2.disconnect);

/**
 * @returns {ResultAsync<boolean, Error>}
 */
function pingDaemon() {
	return ResultAsync.fromPromise(new Promise((resolve, reject) => {
		try {
			// @ts-expect-error - Private API as of 1/17/2022 -> could break
			pm2.Client.pingDaemon(resolve);
		} catch (err) {
			reject(err);
		}
	}),
	(error) => new Error('Failed to ping PM2 daemon', { cause: error })
	);
}
