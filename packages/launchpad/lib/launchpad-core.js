/**
 * @module launchpad-core
 */

import autoBind from 'auto-bind';

import LaunchpadOptions from './launchpad-options.js';
import { LogManager, Logger, onExit } from '@bluecadet/launchpad-utils';
import LaunchpadContent from '@bluecadet/launchpad-content';
import LaunchpadMonitor from '@bluecadet/launchpad-monitor';
import CommandCenter, { Command } from './command-center.js';

/**
 * Core Launchpad class to configure, monitor apps, download content and manage logs.
 */
export class LaunchpadCore {
	/** @type {LaunchpadOptions} */
	_config = null;
	
	/** @type {Logger} */
	_logger = null;
	
	/** @type {LaunchpadContent} */
	_content = null;
	
	/** @type {LaunchpadMonitor} */
	_monitor = null;
	
	/** @type {CommandCenter} */
	_commands = null;
	
	/** @type {boolean} */
	_isShuttingDown = false;
	
	/** @type {boolean} */
	_areAppsRunning = false;
	
	/**
	 * 
	 * @param {LaunchpadOptions|Object} config 
	 */
	constructor(config) {
		autoBind(this);
		
		this._config = new LaunchpadOptions(config);
		this._logger = LogManager.getInstance(this._config.logging).getLogger();
		this._commands = new CommandCenter(this._config.commands, this._logger);
		this._content = new LaunchpadContent(this._config.content, this._logger);
		this._monitor = new LaunchpadMonitor(this._config.monitor, this._logger);
		
		this._commands.add(new Command({ name: 'startup', callback: this._runStartup }));
		this._commands.add(new Command({ name: 'shutdown', callback: this._runShutdown }));
		this._commands.add(new Command({ name: 'start-apps', callback: this._runStartApps }));
		this._commands.add(new Command({ name: 'stop-apps', callback: this._runStopApps }));
		this._commands.add(new Command({ name: 'update-content', callback: this._runUpdateContent }));
		
		this._commands.addCommandHooks(this._config.hooks);
		
		if (this._config.shutdownOnExit) {
			onExit(this.shutdown);
		}
	}
	
	/**
	 * Updates all content and then starts all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async startup() {
		return this._commands.run('startup');
	}
	
	/**
	 * Stops launchpad and exits this process.
	 * This function is queued and waits until the queue is empty before it executes.
	 * 
	 * @param @type {number|string|Error} eventOrExitCode 
	 */
	async shutdown(eventOrExitCode = undefined) {
		return this._commands.run('shutdown', eventOrExitCode);
	}
	
	/**
	 * Starts all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async startApps() {
		return this._commands.run('start-apps');
	}
	
	/**
	 * Stops all apps.
	 * This function is queued and waits until the queue is empty before it executes.
	 */
	async stopApps() {
		return this._commands.run('stop-apps');
	}
	
	/**
	 * Updates all content and optionally first stops and then re-starts all apps after.
	 * This function is queued and waits until the queue is empty before it executes.
	 * 
	 * @param {boolean} stopApps Stop all apps while content is updating and restart them after (whether update was successful or not). Defaults to true.
	 */
	async updateContent(stopApps = true) {
		return this._commands.run('update-content', stopApps);
	}
	
	/**
	 * @private
	 */
	async _runStartup() {
		await this.updateContent();
		await this.startApps();
	}
	
	/**
	 * @private
	 */
	async _runShutdown(eventOrExitCode = 0, ...args) {
		try {
			this._logger.info('Launchpad exiting... 👋');
			
			if (this._isShuttingDown) {
				this._logger.warn('Aborting exit since launchpad is already exiting');
				return Promise.resolve();
			}
			
			this._isShuttingDown = true;
			
			await this._runStopApps();
			
			this._logger.info('...launchpad shut down');
			this._logger.close();
			
			process.exit(isNaN(+eventOrExitCode) ? 1 : +eventOrExitCode);
		} catch (err) {
			this._logger.error('Unhandled exit exception:');
			this._logger.error(err);
		}
	}
	
	/**
	 * @private
	 */
	async _runStartApps() {
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
	 * @private
	 */
	async _runStopApps() {
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
	 * @private
	 * @param {boolean} stopApps
	 */
	async _runUpdateContent(stopApps = true) {
		const appsWereRunning = await this._monitor.isRunning();
		
		if (stopApps && appsWereRunning) {
			this._logger.debug('Stopping apps before updating content');
			await this._runStopApps();
		}
		try {
			await this._content.start();
		} catch (err) {
			this._logger.error('Could not update content', err);
		}
		if (stopApps && appsWereRunning) {
			this._logger.debug('Restarting apps after updating content');
			await this._runStartApps();
		}
	}
}

export default LaunchpadCore;
