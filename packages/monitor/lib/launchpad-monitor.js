import autoBind from 'auto-bind';
import { onExit, LogManager } from '@bluecadet/launchpad-utils';
import { MonitorPluginDriver } from './core/monitor-plugin-driver.js';
import { ProcessManager } from './core/process-manager.js';
import { BusManager } from './core/bus-manager.js';
import { ResultAsync, okAsync, errAsync } from 'neverthrow';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { resolveMonitorConfig } from './monitor-config.js';
import { AppManager } from './core/app-manager.js';

export class LaunchpadMonitor {
	/** @type {import('./monitor-config.js').ResolvedMonitorConfig} */
	_config;
	
	/**
	 * @type {import('@bluecadet/launchpad-utils').Logger}
	 */
	_logger;
	
	/** @type {ProcessManager} */
	_processManager;
	
	/** @type {BusManager} */
	_busManager;
	
	/** @type {AppManager} */
	_appManager;
	
	/** @type {MonitorPluginDriver} */
	_pluginDriver;

	/** @type {boolean} */
	_isShuttingDown = false;
	
	/**
	 * @param {import('./monitor-config.js').MonitorConfig} config
	 * @param {import('@bluecadet/launchpad-utils').Logger} parentLogger
	 */
	constructor(config, parentLogger) {
		autoBind(this);
		this._logger = LogManager.getLogger('monitor', parentLogger);
		this._config = resolveMonitorConfig(config);
		
		this._processManager = new ProcessManager(this._logger);
		this._busManager = new BusManager(this._logger);
		this._appManager = new AppManager(
			this._logger,
			this._processManager,
			this._busManager,
			this._config
		);

		if (this._config.shutdownOnExit) {
			onExit(() => { this.shutdown(); });
		}

		const basePluginDriver = new PluginDriver(this._logger, this._config.plugins);
		this._pluginDriver = new MonitorPluginDriver(basePluginDriver);
	}
	
	/**
	 * Checks if we're currently connected to PM2.
	 * @returns {ResultAsync<boolean, Error>}
	 */
	isConnected() {
		return this._processManager.isDaemonRunning();
	}
	
	/**
	 * Connects to the PM2 daemon and tails all logs.
	 * Call this before starting any apps.
	 * 
	 * @param {boolean} ensureDaemonOwnership This will kill the existing PM2 daemon if it's already running.
	 * @returns {ResultAsync<void, Error>}
	 */
	connect(ensureDaemonOwnership = true) {
		return this._busManager.disconnect()
			.andThen(() => this._processManager.isDaemonRunning())
			.andThen(isDaemonRunning => {
				if (ensureDaemonOwnership && isDaemonRunning) {
					return this._handleExistingDaemon();
				}
				return okAsync(undefined);
			})
			.andThen(() => {
				this._logger.info('Connecting to PM2');
				return this._processManager.connect();
			})
			.andThen(() => this._busManager.connect());
	}

	/**
	 * @private
	 * @returns {ResultAsync<void, Error>}
	 */
	_handleExistingDaemon() {
		if (this._config.deleteExistingBeforeConnect) {
			this._logger.debug('Deleting existing PM2 processes');
			return this._processManager.deleteAllProcesses()
				.andThen(() => {
					this._logger.debug('Killing existing PM2 daemon');
					return this._processManager.killPm2();
				});
		}
		return okAsync(undefined);
	}
	
	/**
	 * Disconnects from the PM2 daemon and stops tailing all logs.
	 * @returns {ResultAsync<void, Error>}
	 */
	disconnect() {
		this._logger.info('Disconnecting from PM2');
		
		return this._busManager.disconnect()
			.andThen(() => this._processManager.isDaemonRunning())
			.andThen(isDaemonRunning => {
				if (isDaemonRunning) {
					this._logger.debug('Disconnecting from daemon');
					return this._processManager.disconnect();
				}
				return okAsync(undefined);
			});
	}
	
	/**
	 * Starts an app or a list of apps. Will connect to PM2 if not connected previously.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {ResultAsync<void, Error>}
	 */
	start(appNames = null) {
		return this._processManager.isDaemonRunning()
			.andThen(isDaemonRunning => {
				if (!isDaemonRunning) {
					return this.connect();
				}
				return okAsync(undefined);
			})
			.andThen(() => {
				const validatedNames = this._appManager.validateAppNames(appNames);
				
				if (!validatedNames || validatedNames.length === 0) {
					this._logger.warn('No apps configured to start');
					return okAsync(undefined);
				} else {
					this._logger.info(`Starting app(s): ${validatedNames.join(', ')}`);
				}
				
				return ResultAsync.combine(
					validatedNames.map(name => this._appManager.startApp(name))
				).andThen(() => this._appManager.applyWindowSettings());
			});
	}
	
	/**
	 * Stops an app or a list of apps.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {ResultAsync<void, Error>}
	 */
	stop(appNames = null) {
		const validatedNames = this._appManager.validateAppNames(appNames);
		this._logger.info(`Stopping app(s): ${validatedNames}`);
		
		if (!validatedNames || validatedNames.length === 0) {
			this._logger.warn('No apps configured to stop');
			return okAsync(undefined);
		}
		
		return ResultAsync.combine(
			validatedNames.map(name => this._appManager.stopApp(name))
		).map(() => undefined);
	}
	
	/**
	 * Checks if any of these apps are currently running.
	 * @param {string|string[]|null} appNames Single app name, array of app names or null/undefined to default to all apps.
	 * @returns {ResultAsync<boolean, Error>}
	 */
	isRunning(appNames = null) {
		const validatedNames = this._appManager.validateAppNames(appNames);
		
		return ResultAsync.combine(
			validatedNames.map(name => this._appManager.isAppRunning(name, true))
		).map(results => results.some(isRunning => isRunning));
	}
	
	/**
	 * Gets the info of a running process
	 * @param {string} appName The name of the app/process
	 * @param {boolean} silent Disables warnings when processes can't be found.
	 * @returns {ResultAsync<import('pm2').ProcessDescription, Error>}
	 */
	getAppProcess(appName, silent = false) {
		return this._processManager.getProcess(appName, silent);
	}
	
	/**
	 * Stops launchpad and exits this process.
	 * @param {number|string|Error} [eventOrExitCode] 
	 * @returns {ResultAsync<void, Error>}
	 */
	shutdown(eventOrExitCode = undefined) {
		this._logger.info('Monitor exiting... 👋');
		
		if (this._isShuttingDown) {
			this._logger.warn('Aborting exit since launchpad is already exiting');
			return okAsync(undefined);
		}
		
		this._isShuttingDown = true;
		
		return this.stop()
			.andThen(() => this.disconnect())
			.andThen(() => {
				this._logger.info('...apps stopped ✋');
				this._logger.info('...monitor shut down');
				this._logger.close();
				
				process.exit(
					eventOrExitCode === undefined || isNaN(+eventOrExitCode)
						? 1
						: +eventOrExitCode
				);
			})
			.mapErr(error => {
				this._logger.error('Unhandled exit exception:', error);
				return error;
			});
	}
}

export default LaunchpadMonitor;
