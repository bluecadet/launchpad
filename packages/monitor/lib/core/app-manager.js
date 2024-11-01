import { ResultAsync, err, ok, okAsync } from 'neverthrow';
import sortWindows from '../utils/sort-windows.js';

export class AppManager {
	/** @type {import('@bluecadet/launchpad-utils').Logger} */
	_logger;

	/** @type {import('./process-manager.js').ProcessManager} */
	_processManager;

	/** @type {import('./bus-manager.js').BusManager} */
	_busManager;

	/** @type {import('../monitor-config.js').ResolvedMonitorConfig} */
	_config;

	/**
   * @param {import('@bluecadet/launchpad-utils').Logger} logger
   * @param {import('./process-manager.js').ProcessManager} processManager
   * @param {import('./bus-manager.js').BusManager} busManager
   * @param {import('../monitor-config.js').ResolvedMonitorConfig} config
   */
	constructor(logger, processManager, busManager, config) {
		this._logger = logger;
		this._processManager = processManager;
		this._busManager = busManager;
		this._config = config;
	}

	/**
   * @param {string} appName 
   * @returns {ResultAsync<import('pm2').ProcessDescription, Error>}
   */
	startApp(appName) {
		this._logger.info(`Starting app '${appName}'...`);
		const options = this.getAppOptions(appName);

		return this._processManager.startProcess(options.pm2)
			.andThen(() => this._processManager.getProcess(appName))
			.map(process => {
				this._logger.info(`...app '${appName}' was started.`);
				return process;
			});
	}

	/**
   * @param {string} appName 
   * @returns {ResultAsync<import('pm2').ProcessDescription, Error>}
   */
	stopApp(appName) {
		this._logger.info(`Stopping app '${appName}'...`);
    
		return this._processManager.stopProcess(appName)
			.map(process => {
				this._logger.info(`...app '${appName}' was stopped.`);
				return process;
			});
	}

	/**
   * @param {string} appName 
   * @param {boolean} silent
   * @returns {ResultAsync<boolean, Error>}
   */
	isAppRunning(appName, silent = true) {
		return this._processManager.getProcess(appName, silent)
			.map(process => process?.pm2_env?.status === 'online')
			.orElse(() => okAsync(false));
	}

	/**
   * @param {string|string[]|null} appNames 
   * @returns {string[]}
   */
	validateAppNames(appNames = null) {
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
   * @returns {string[]}
   */
	getAllAppNames() {
		if ('apps' in this._config) {
			return this._config.apps
				.map(app => app.pm2.name)
				.filter(name => name !== undefined);
		}
		return [];
	}

	/**
   * @param {string} appName 
   * @returns {import('../monitor-config.js').ResolvedAppConfig}
   */
	getAppOptions(appName) {
		const options = this._config.apps.find(app => app.pm2.name === appName);
		if (!options) {
			throw new Error(`No app found with the name '${appName}'`);
		}
		return options;
	}

	/**
   * @param {Array<string>} appNames 
   */
	applyWindowSettings(appNames = []) {
		appNames = this.validateAppNames(appNames);

		const appResults = appNames.map((appName) => {
			const sortApp = {
				options: this.getAppOptions(appName),
				pid: /** @type {number|null} */ (null)
			};

			return this._processManager.getProcess(appName).andThen(process => {
				if (process.pid !== undefined) {
					sortApp.pid = process.pid;
					return ok(sortApp);
				} else {
					return err(new Error(`No process found for app ${appName}`));
				}
			});
		});

		return ResultAsync.combine(appResults).andThen((apps) => {
			return ResultAsync.fromPromise(sortWindows(apps, this._logger, this._config.windowsApi.nodeVersion), e => new Error('Failed to sort windows', { cause: e }));
		});
	}
}
