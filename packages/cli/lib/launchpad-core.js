/**
 * @module launchpad-core
 */

import autoBind from 'auto-bind';

import { LogManager, onExit } from '@bluecadet/launchpad-utils';
import LaunchpadContent from '@bluecadet/launchpad-content';
import LaunchpadMonitor from '@bluecadet/launchpad-monitor';
import { resolveLaunchpadOptions } from './launchpad-options.js';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

/**
 * Core Launchpad class to configure, monitor apps, download content and manage logs.
 */
export class LaunchpadCore {
	/** @type {import('./launchpad-options.js').ResolvedLaunchpadOptions} */
	_config;
	
	/** @type {import('@bluecadet/launchpad-utils').Logger} */
	_logger;
	
	/** @type {LaunchpadContent} */
	_content;
	
	/** @type {LaunchpadMonitor} */
	_monitor;
	
	/** @type {boolean} */
	_isShuttingDown = false;
	
	/** @type {boolean} */
	_areAppsRunning = false;

	/** @type {PluginDriver<import('./launchpad-options.js').AllHooks>}  */
	_pluginDriver;
	
	/**
	 * 
	 * @param {import('./launchpad-options.js').LaunchpadOptions} config 
	 */
	constructor(config) {
		autoBind(this);
		
		this._config = resolveLaunchpadOptions(config);
		this._logger = LogManager.getInstance(this._config.logging).getLogger();
		this._pluginDriver = new PluginDriver(this._logger, this._config.plugins ?? []);
		this._content = new LaunchpadContent(this._config, this._logger);
		this._monitor = new LaunchpadMonitor(this._config, this._logger);
		
		if (this._config.shutdownOnExit) {
			onExit(this.shutdown);
		}
	}
	
	/**
	 * Updates all content and then starts all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async startup() {
		await this.updateContent();
		await this.startApps();
	}
	
	/**
	 * Stops launchpad and exits this process.
	 * This function is queued and waits until the queue is empty before it executes.
	 * 
	 * @param {number|string|Error} [eventOrExitCode] 
	 */
	async shutdown(eventOrExitCode = undefined) {
		try {
			this._logger.info('Launchpad exiting... 👋');
			
			if (this._isShuttingDown) {
				this._logger.warn('Aborting exit since launchpad is already exiting');
				return Promise.resolve();
			}
			
			this._isShuttingDown = true;
			
			await this.stopApps();
			
			this._logger.info('...launchpad shut down');
			this._logger.close();
			
			process.exit(eventOrExitCode === undefined || isNaN(+eventOrExitCode) ? 1 : +eventOrExitCode);
		} catch (err) {
			this._logger.error('Unhandled exit exception:');
			this._logger.error(err);
		}
	}
	
	/**
	 * Starts all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async startApps() {
		this._logger.info('Starting apps...');
		if (this._areAppsRunning) {
			this._logger.warn('Aborting apps start since apps are already running');
			return Promise.resolve();
		}
		await this._monitor.connect();
		await this._monitor.start();
		this._logger.info('...apps started 👍');
		this._areAppsRunning = true;
	}
	
	/**
	 * Stops all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async stopApps() {
		this._logger.info('Stopping apps...');
		if (!this._areAppsRunning) {
			this._logger.warn('All apps are already stopped');
			return Promise.resolve();
		}
		await this._monitor.stop();
		await this._monitor.disconnect();
		this._logger.info('...apps stopped ✋');
		this._areAppsRunning = false;
	}
	
	/**
	 * Updates all content and optionally first stops and then re-starts all apps after.
	 * This function is queued and waits until the queue is empty before it executes.
	 * 
	 * @param {boolean} stopApps Stop all apps while content is updating and restart them after (whether update was successful or not). Defaults to true.
	 */
	async updateContent(stopApps = true) {
		const appsWereRunning = await this._monitor.isRunning();
		
		if (stopApps && appsWereRunning) {
			this._logger.debug('Stopping apps before updating content');
			await this.stopApps();
		}
		try {
			await this._content.start();
		} catch (err) {
			this._logger.error('Could not update content', err);
		}
		if (stopApps && appsWereRunning) {
			this._logger.debug('Restarting apps after updating content');
			await this.startApps();
		}
	}
}

export default LaunchpadCore;
