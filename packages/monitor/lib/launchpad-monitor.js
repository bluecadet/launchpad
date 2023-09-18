/**
 * @module launchpad-monitor/monitor-options
 */

import chalk from 'chalk';
import autoBind from 'auto-bind';
import pDebounce from 'p-debounce';
import pm2 from 'pm2';
import { spawn } from 'cross-spawn';
import { SubEmitterSocket } from 'axon'; // used by PM2
import util from 'util';

import { LogManager, Logger } from '@bluecadet/launchpad-utils';
import AppLogRouter from './app-log-router.js';
import { AppLogOptions, AppOptions, MonitorOptions, WindowOptions } from './monitor-options.js';
import sortWindows, { SortApp } from './utils/sort-windows.js';

export class LaunchpadMonitor {
	/** @type {MonitorOptions} */
	_config;
	
	/**
	 * @type {Logger}
	 */
	_logger;
	
	/** @type {AppLogRouter} */
	_appLogRouter;
	
	/**
	 * appName -> number of launches
	 * @type {Map<string,number>}
	 */
	_numAppLaunches = new Map();
	
	/**
	 * @type {SubEmitterSocket | null}
	 */
	_pm2Bus = null;
	
	/**
	 * Creates a new instance, starts it with the
	 * config and resolves with the monitor instance.
	 * @param {MonitorOptions} config 
	 * @returns {Promise<LaunchpadMonitor>} Promise that resolves with the new LaunchpadMonitor instance.
	 */
	static async createAndStart(config) {
		const monitor = new LaunchpadMonitor(config);
		await monitor.connect();
		await monitor.start();
		return monitor;
	}
	
	/** 
	 * Force kills all PM2 instances 
	 * @returns {Promise<void>}
	 */
	static async kill() {
		const logger = LogManager.getInstance().getLogger('monitor');
		logger.info('Killing PM2...');

		return new Promise((resolve, reject) => {
			const child = spawn('npm', ['exec', 'pm2', 'kill'], {
				shell: true
			});
			child.stdout.on('data', data => logger.info(data));
			child.stderr.on('data', data => logger.error(data));
			child.on('error', error => {
				logger.error(`PM2 could not be killed: ${error}`);
				reject(new Error(`PM2 could not be killed: ${error}`));
			});
			child.on('close', () => {
				logger.info('PM2 has been killed');
				resolve();
			});
		});
	}
	
	/**
	 * 
	 * @param {MonitorOptions|Object} config 
   * @param {Logger} [parentLogger]
	 */
	constructor(config, parentLogger) {
		autoBind(this);
		this._logger = LogManager.getInstance().getLogger('monitor', parentLogger);
		this._config = new MonitorOptions(config);
		this._appLogRouter = new AppLogRouter(this._logger);
		this._applyWindowSettings = pDebounce(
			this._applyWindowSettings,
			this._config.windowsApi.debounceDelay
		);
		
		if (!this._config.apps || this._config.apps.length === 0) {
			this._logger.warn('No apps defined for monitoring');
		} else {
			this._config.apps.forEach(this._initAppOptions);
		}
	}
	
	/**
	 * Checks if we're currently connected to PM2.
	 * @returns {Promise<boolean>}
	 */
	async isConnected() {
		return this._isDaemonRunning();
	}
	
	/**
	 * Connects to the PM2 daemon and tails all logs.
	 * Call this before starting any apps.
	 * 
	 * @param {boolean} ensureDaemonOwnership This will kill the existing PM2 daemon if it's already running. That will cause existing apps to close, but it will result in this current process owning the daemon and having better control of which apps run in the foreground or background. The default is true.
	 */
	async connect(ensureDaemonOwnership = true) {
		await this._disconnectPm2Bus();
		
		const isDaemonRunning = await this._isDaemonRunning();
		if (ensureDaemonOwnership && isDaemonRunning) {
			if (this._config.deleteExistingBeforeConnect) {
				this._logger.debug('Deleting existing PM2 processes');
				await this.deleteAllProcesses();
			}
			this._logger.debug('Killing existing PM2 daemon');
			await this._promisify(pm2.killDaemon, pm2);
		}
		
		this._logger.info('Connecting to PM2');
		await this._promisify(pm2.connect, pm2, true);
		await this._connectPm2Bus();
	}
	
	/**
	 * Disconnects from the PM2 daemon and stops tailing all logs.
	 * Call this after stopping all apps and before shutting down.
	 */
	async disconnect() {
		this._logger.info('Disconnecting from PM2');
		
		await this._disconnectPm2Bus();
		
		const isDaemonRunning = await this._isDaemonRunning();
		
		if (isDaemonRunning) {
			this._logger.debug('Disconnecting from daemon');
			await this._promisify(pm2.disconnect, pm2);
		}
	}
	
	/**
	 * Starts an app or a list of app. Will connect to PM2 if not connected previously.
	 * If no argument is passed, will start all apps.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise<void>}
	 */
	async start(appNames = null) {
		const isDaemonRunning = await this._isDaemonRunning();
		
		if (!isDaemonRunning) {
			await this.connect();
		}
		
		appNames = this._validateAppNames(appNames);
		this._logger.info(`Starting app(s): ${appNames}`);
		
		if (!appNames || appNames.length === 0) {
			this._logger.warn('No apps configured to start');
			return Promise.resolve();
		}
		
		for (const appName of appNames) {
			await this._startApp(appName);
		}
		
		await this._applyWindowSettings();
		
		return Promise.resolve();
	}
	
	/**
	 * Stops an app or a list of app.
	 * If no argument is passed, will stop all apps.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise<void>}
	 */
	async stop(appNames = null) {
		appNames = this._validateAppNames(appNames);
		this._logger.info(`Stopping app(s): ${appNames}`);
		
		if (!appNames || appNames.length === 0) {
			this._logger.warn('No apps configured to stop');
			return Promise.resolve();
		}
		
		for (const appName of appNames) {
			await this._stopApp(appName);
		}
		return Promise.resolve();
	}
	
	/**
	 * Checks if any of these apps is currently running.
	 * Checks against all apps if no argument is passed.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise<boolean>}
	 */
	async isRunning(appNames = null) {
		appNames = this._validateAppNames(appNames);
		for (const appName of appNames) {
			if (await this._isAppRunning(appName, true)) {
				return true;
			}
		}
		return false;
	}
	
	/**
	 * Gets the info of a running process
	 * @param {string} appName The name of the app/process
	 * @param {boolean} silent Disables warnings when processes can't be found. Defaults to false.
	 * @returns {Promise<pm2.ProcessDescription>}
	 */
	async getAppProcess(appName, silent = false) {
		return this._promisify(pm2.list, pm2).then((/** @type {any[]} */ processes) => {
			const info = processes.find((/** @type {{ name: string; }} */ appProcess) => appProcess.name === appName);
			if (!info) {
				throw new Error(`No process found with the name '${appName}'`);
			}
			return info;
		}).catch((/** @type {any} */ err) => {
			if (!silent) {
				this._logger.warn(`Could not retrieve process info for: ${appName} (${err})`);
			}
		});
	}
	
	/**
	 * Deletes all stored configs for all processes currently listed by PM2.
	 * @returns {Promise<void>}
	 */
	async deleteAllProcesses() {
		try {
			const processes = await this._promisify(pm2.list, pm2);
			for (const process of processes) {
				if (process.name) {
					this._logger.debug(`Deleting process ${process.name}`);
					await this._promisify(pm2.delete, pm2, process.name);
				}
			}
		} catch (err) {
			this._logger.error(`Could not delete all processes (${err})`);
		}
	}
	
	/**
	 * Get the startup options for appName
	 * @param {string} appName 
	 * @returns {AppOptions}
	 */
	getAppOptions(appName) {
		const options = this._config.apps.find(app => app.pm2.name === appName);
		if (!options) {
			throw new Error(`No app found with the name '${appName}'`);
		}
		return options;
	}
	
	/**
	 * @returns {Array<string>} An array containing the names of all configured apps (not to be confused with running processes).
	 */
	getAllAppNames() {
		if ('apps' in this._config) {
			return this._config.apps.map(app => app.pm2.name).filter(
				/** 
				 * @param {string|undefined} name 
				 * @returns {name is string}
				*/
				name => name !== undefined
			);
		} else {
			return [];
		}
	}
	
	/**
	 * @param {string} appName 
	 * @returns {Promise.<pm2.ProcessDescription>}
	 */
	async _startApp(appName) {
		this._logger.info(`Starting app '${appName}'...`);
		
		const options = this.getAppOptions(appName);
		
		// @ts-expect-error TS get's confused with the overloaded start signatures
		return this._promisify(pm2.start, pm2, options.pm2)
			.then(async (/** @type {any} */ appProcess) => {
				// Get expanded process info (otherwise pm2 just returns partial)
				return (await this.getAppProcess(appName)) || appProcess;
			})
			.then(async (/** @type {any} */ appProcess) => {
				this._logger.info(`...app '${appName}' was started.`);
				return appProcess;
			})
			.catch((/** @type {any} */ err) => {
				this._logger.error(`Could not start app '${appName}':`);
				this._logger.error(err);
				throw err;
			});
	}
	
	/**
	 * @param {string} appName 
	 * @returns {Promise.<pm2.Proc>}
	 */
	async _stopApp(appName) {
		this._logger.info(`Stopping app '${appName}'...`);
		
		return this._promisify(pm2.stop, pm2, appName)
			.then(async (/** @type {any} */ appProcess) => {
				this._logger.info(`...app '${appName}' was stopped.`);
				return appProcess;
			}).catch((/** @type {any} */ err) => {
				this._logger.error(`Could not stop app '${appName}':`, err);
				throw err;
			});
	}
	
	/**
	 * @param {string} appName 
	 * @param {boolean} silent Disables error output if process info can't be retrieved. Defaults to true. 
	 * @returns {Promise<boolean>}
	 */
	async _isAppRunning(appName, silent = true) {
		return this.getAppProcess(appName, silent)
			.then((appProcess) => {
				return !!appProcess && !!appProcess.pm2_env && appProcess.pm2_env.status === 'online';
			}).catch(err => {
				if (!silent) {
					this._logger.warn(`Could not check if app '${appName}' is running: ${err}`);
				}
				return false;
			});
	}
	
	async _isDaemonRunning() {
		this._logger.debug('Checking if daemon is running...');
		return new Promise((resolve, reject) => {
			try {
				// @ts-expect-error - Private API as of 1/17/2022 -> could break
				pm2.Client.pingDaemon(resolve);
			} catch (err) {
				reject(err);
			}
		}).then(isRunning => {
			this._logger.debug(`Daemon is running: ${isRunning}`);
			return isRunning;
		}).catch(err => {
			this._logger.warn('Could not ping daemon', err);
			return false;
		});
	}
	
	/**
	 * @param {string|string[]|null} appNames 
	 * @returns {(string)[]}
	 */
	_validateAppNames(appNames = null) {
		if (appNames === null || appNames === undefined) {
			return this.getAllAppNames();
		}
		if ((typeof appNames === 'string')) {
			return [appNames];
		}
		if (Symbol.iterator in Object(appNames)) {
			return [...appNames];
		}
		throw new Error('appNames must be null, undefined, a string or an iterable array/set of strings');
	}
	
	/**
	 * @param {AppOptions} options 
	 * @returns {AppOptions} 
	 */
	_initAppOptions(options) {
		if (!options.pm2 || !options.pm2.name) {
			this._logger.error('PM2 config is incomplete or missing:', options);
			return options;
		}
		options.logging = new AppLogOptions(options.logging);
		options.windows = new WindowOptions(options.windows);
		
		// @ts-expect-error - Undocumented PM2 field that can prevent your apps from actually showing on launch. Set this to false to prevent that default behavior.
		options.pm2.windowsHide = options.windows.hide;
		this._appLogRouter.initAppOptions(options);
		
		return options;
	}
	
	/**
	 * Applies windows settings to all apps in appNames based on their options.
	 * 
	 * @param {Array<string>} appNames 
	 * @returns {Promise<void>}
	 */
	async _applyWindowSettings(appNames = []) {
		appNames = this._validateAppNames(appNames);
		const apps = [];
		
		for (const appName of appNames) {
			const sortApp = new SortApp(this.getAppOptions(appName));

			try {
				const process = await this.getAppProcess(appName);

				if (process.pid === undefined) {
					this._logger.error(`No process found for app ${appName}`);
					continue;
				}

				sortApp.pid = process.pid;
			} catch (error) {
				this._logger.error(`Could not get process for app ${appName}`);
				continue;
			}
			
			apps.push(sortApp);
		}
		
		return sortWindows(apps, this._logger, this._config.windowsApi.nodeVersion);
	}
	
	async _connectPm2Bus() {
		this._logger.debug('Connecting to PM2 bus');
		this._pm2Bus = await this._promisify(pm2.launchBus, pm2);
		if (this._pm2Bus) {
			this._pm2Bus.on('process:event', this._handleBusProcessEvent);
			this._appLogRouter.connectToBus(this._pm2Bus);
		}
	}
	
	async _disconnectPm2Bus() {
		if (this._pm2Bus) {
			this._logger.debug('Disconnecting from PM2 bus');
			this._appLogRouter.disconnectFromBus(this._pm2Bus);
			this._pm2Bus.off('process:event');
			this._pm2Bus = null;
		}
	}
	
	/**
	 * @param {*} eventData 
	 */
	async _handleBusProcessEvent(eventData) {
		try {
			if (!eventData || !eventData.process || !eventData.process.name) {
				return;
			}
			// For all event types @see https://github.com/Unitech/pm2/blob/f6c70529bbc04c0e1340e519eddb1534b952c438/test/interface/bus.spec.mocha.js#L93
			const appName = eventData.process.name;
			const processEventType = eventData.event;
			switch (processEventType) {
				case 'start':
					this._logger.debug(`App is starting: ${chalk.yellow(appName)}`);
					break;
				case 'online': {
					this._logger.debug(`App is online: ${chalk.green(appName)}`);
					let numLaunches = 1;
					if (this._numAppLaunches.has(appName)) {
						numLaunches = (this._numAppLaunches.get(appName) ?? 0) + 1;
					}
					if (numLaunches > 1) {
						await this._applyWindowSettings();
					}
					this._numAppLaunches.set(appName, numLaunches);
					break;
				}
				case 'exit':
					this._logger.debug(`App has exited: ${chalk.red(appName)}`);
					break;
				case 'stop':
					this._logger.debug(`App is stopping: ${chalk.yellow(appName)}`);
					break;
			}
		} catch (err) {
			this._logger.error('Could not process bus event');
			this._logger.error(err);
		}
	}

	/**
	 * @template P
	 * @template {readonly unknown[]} Q
	 * @typedef  {((err:P, ...results: Q) => void)} PromisifyCallback
	 */
	
	/**
	 * @template {readonly unknown[]} T
	 * @template U
	 * @template {readonly unknown[]} V
	 * @param {(...fargs: [...T, PromisifyCallback<U, V>]) => void} fn
	 * @param {unknown} scope
	 * @param {T} args
	 * @returns {Promise<V[0]>}
	 */
	_promisify(fn, scope, ...args) {
		return new Promise((resolve, reject) => {
			if (scope) {
				fn = fn.bind(scope);
			}

			/**
			 * @type {PromisifyCallback<U, V>}
			 */
			const cb = (err, ...result) => {
				if (err) {
					reject(err);
				} else {
					resolve(result[0]);
				}
			};

			fn(...args, cb);
		});
	}
}

export default LaunchpadMonitor;
