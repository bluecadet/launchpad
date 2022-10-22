/**
 * @module launchpad-monitor/monitor-options
 */

import chalk from 'chalk';
import autoBind from 'auto-bind';
import pDebounce from 'p-debounce';
import pm2 from 'pm2';
import semver from 'semver';
import { spawn } from 'cross-spawn';
import { SubEmitterSocket } from 'axon'; // used by PM2

import { LogManager, Logger } from '@bluecadet/launchpad-utils';
import AppLogRouter from './app-log-router.js';
import { AppLogOptions, MonitorOptions, WindowOptions } from './monitor-options.js';

export class LaunchpadMonitor {
	/** @type {MonitorOptions} */
	_config = null;
	
	/**
	 * @type {Logger}
	 */
	_logger = null;
	
	/** @type {AppLogRouter} */
	_appLogRouter = null;
	
	/**
	 * appName -> number of launches
	 * @type {Map<string,number>}
	 */
	_numAppLaunches = new Map();
	
	/**
	 * @type {SubEmitterSocket}
	 */
	_pm2Bus = null;
	
	/**
	 * @type {Object}
	 */
	_windowsApi = null;
	
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
	
	/** Force kills all PM2 instances */
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
				reject();
			});
			child.on("close", () => {
				logger.info('PM2 has been killed');
				resolve();
			});
		});
	}
	
	/**
	 * 
	 * @param {MonitorOptions|Object} config 
   * @param {Logger} parentLogger
	 */
	constructor(config, parentLogger = null) {
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
		await this._promisify(pm2.connect, pm2);
		
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
	 * @param @type {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise}
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
	 * @param @type {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise}
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
	 * @param @type {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {Promise}
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
		return this._promisify(pm2.list, pm2).then(processes => {
			const info = processes.find(appProcess => appProcess.name === appName);
			if (!info) {
				throw new Error(`No process found with the name '${appName}'`);
			}
			return info;
		}).catch(err => {
			if (!silent) {
				this._logger.warn(`Could not retrieve process info for: ${appName} (${err})`);
			}
		});
	}
	
	/**
	 * Deletes all stored configs for all processes currently listed by PM2.
	 * @returns {Promise}
	 */
	async deleteAllProcesses() {
		try {
			const processes = await this._promisify(pm2.list, pm2);
			for (const process of processes) {
				this._logger.debug(`Deleting process ${process.name}`);
				await this._promisify(pm2.delete, pm2, process.name);
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
	 * @returns {Array.<string>} An array containing the names of all configured apps (not to be confused with running processes).
	 */
	getAllAppNames() {
		if ('apps' in this._config) {
			return this._config.apps.map(app => app.pm2.name);
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
		
		return this._promisify(pm2.start, pm2, options.pm2)
			.then(async appProcess => {
				// Get expanded process info (otherwise pm2 just returns partial)
				return (await this.getAppProcess(appName)) || appProcess;
			})
			.then(async appProcess => {
				this._logger.info(`...app '${appName}' was started.`);
				return appProcess;
			})
			.catch(err => {
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
			.then(async appProcess => {
				this._logger.info(`...app '${appName}' was stopped.`);
				return appProcess
			}).catch(err => {
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
				return appProcess && appProcess.pm2_env && appProcess.pm2_env.status === 'online';
			}).catch(err => {
				if (!silent) {
					this._logger.warn(`Could not check if app '${appName}' is running: ${err}`);
				}
			});
	}
	
	async _isDaemonRunning() {
		this._logger.debug('Checking if daemon is running...');
		return new Promise((resolve, reject) => {
			try {
				// Private API as of 1/17/2022 -> could break
				pm2.Client.pingDaemon(resolve);
			} catch (err) {
				reject(err);
			}
		}).then(isRunning => {
			this._logger.debug(`Daemon is running: ${isRunning}`);
			return isRunning;
		}).catch(err => {
			this._logger.warn(`Could not ping daemon`, err);
			return false;
		});
	}
	
	/**
	 * @param @type {string|string[]|null} appNames 
	 * @returns {string[]}
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
		throw new Error(`appNames must be null, undefined, a string or an iterable array/set of strings`);
	}
	
	/**
	 * @param {AppOptions} options 
	 * @returns {AppOptions} 
	 */
	_initAppOptions(options) {
		if (!options.pm2 || !options.pm2.name) {
			this._logger.error(`PM2 config is incomplete or missing:`, options);
			return options;
		}
		options.logging = new AppLogOptions(options.logging);
		options.windows = new WindowOptions(options.windows);
		
		// Undocumented PM2 field that can prevent your apps from actually showing on launch. Set this to false to prevent that default behavior.
		options.pm2.windowsHide = options.windows.hide;
		return this._appLogRouter.initAppOptions(options);
	}
	
	/**
	 * Applies windows settings to all apps in appNames based on their options.
	 * 
	 * @param {Array.<string>} appNames 
	 * @returns {Promise}
	 */
	async _applyWindowSettings(appNames = null) {
		
		if (!this._isWindowsOS()) {
			this._logger.warn(`Not applying windows settings since this is only supported on Windows OS.`);
			return;
		}
		
		const currVersion = process.version;
		const requVersion = this._config.windowsApi.nodeVersion;
		
		if (!semver.satisfies(currVersion, requVersion)) {
			this._logger.warn(`Not applying window settings since your node version '${currVersion}' doesn't satisfy the required version '${requVersion}'. Please upgrade node to apply window settings like foreground/minimize/hide.`);
			return;
		}
		
		appNames = this._validateAppNames(appNames);
		
		this._logger.info(`Applying window settings to apps: ${appNames}...`);
		
		let windowsApi = null;
		try {
			windowsApi = await this._getWindowsApi();
		} catch (err) {
			this._logger.error(`Could not retrieve Windows API libraries. Make sure optional deps are installed: 'npm i robotjs ffi-napi ref-napi'`, err);
		}
		
		const fgPids = [];
		const minPids = [];
		const hidePids = [];
		
		for (const appName of appNames) {
			const appOptions = this.getAppOptions(appName);
			const winOptions = appOptions.windows;
			const appProcess = await this.getAppProcess(appName);
			
			if (!appProcess || appProcess.pm2_env.status !== 'online') {
				this._logger.warn(`Not applying window settings to ${appName} because it's not online.`);
				return appProcess;
			}
			
			const appLabel = `${appName} (pid: ${appProcess.pid})`;
			
			if (winOptions.foreground) {
				this._logger.debug(`...foregrounding ${appLabel}`);
				fgPids.push(appProcess.pid);
			}
			if (winOptions.minimize) {
				this._logger.debug(`...minimizing ${appLabel}`);
				minPids.push(appProcess.pid);
			}
			if (winOptions.hide) {
				this._logger.debug(`...hiding ${appLabel}`);
				hidePids.push(appProcess.pid);
			}
		}
		
		windowsApi.sortWindows(fgPids, minPids, hidePids);
		
		this._logger.debug(`...done applying window settings.`);
	}
	
	async _getWindowsApi() {
		if (!this._windowsApi) {
			// Importing at runtime allows optional dependencies for non-Windows platforms
			this._windowsApi = await import('./windows-api.js');
		}
		return this._windowsApi;
	}
	
	_isWindowsOS() {
		return process.platform === 'win32';
	}
	
	async _connectPm2Bus() {
		this._logger.debug('Connecting to PM2 bus');
		this._pm2Bus = await this._promisify(pm2.launchBus, pm2);
		this._pm2Bus.on('process:event', this._handleBusProcessEvent);
		this._appLogRouter.connectToBus(this._pm2Bus);
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
			const appProcess = await this.getAppProcess(appName);
			const processEventType = eventData.event;
			switch (processEventType) {
				case 'start':
					this._logger.debug(`App is starting: ${chalk.yellow(appName)}`);
					break;
				case 'online':
					this._logger.debug(`App is online: ${chalk.green(appName)}`);
					this._appLogRouter.watchProcess(appProcess);
					let numLaunches = this._numAppLaunches.has(appName) ?
						(this._numAppLaunches.get(appName) + 1) : 1;
					if (numLaunches > 1) {
						await this._applyWindowSettings();
					}
					this._numAppLaunches.set(appName, numLaunches);
					break;
				case 'exit':
					this._logger.debug(`App has exited: ${chalk.red(appName)}`);
					this._appLogRouter.unwatchProcess(appProcess);
					break;
				case 'stop':
					this._logger.debug(`App is stopping: ${chalk.yellow(appName)}`);
					break;
			}
		} catch (err) {
			this._logger.error(`Could not process bus event`);
			this._logger.error(err);
		}
	}
	
	_promisify(fn, scope = null, ...args) {
		return new Promise((resolve, reject) => {
			if (scope) {
				fn = fn.bind(scope);
			}
			fn(...args, (err, ...results) => {
				if (err) {
					reject(err);
				} else {
					resolve(...results);
				}
			});
		})
	}
}

export default LaunchpadMonitor;

