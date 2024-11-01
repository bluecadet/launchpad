import { ok, err, Result, ResultAsync } from 'neverthrow';
import { SubEmitterSocket } from 'axon';
import pm2 from 'pm2';
import { LogManager } from '@bluecadet/launchpad-utils';
import { LogModes } from '../monitor-config.js';
import { Tail } from 'tail';

export class BusManager {
	/**
   * @private
   * @type {import('@bluecadet/launchpad-utils').Logger}
   */
	_logger;

	/**
   * @private
   * @type {SubEmitterSocket | null}
   */
	_bus = null;

	/**
   * @private
   * @type {Set<(eventType: string, eventData: any) => void>}
   */
	_eventHandlers = new Set();

	/**
   * @private
   * @type {Map<string, Tail>}
   */
	_outTails = new Map();

	/**
   * @private
   * @type {Map<string, Tail>}
   */
	_errTails = new Map();

	/**
   * @private
   * @type {Map<string, import('../monitor-config.js').ResolvedAppConfig>}
   */
	_appConfigs = new Map();

	/**
   * @param {import('@bluecadet/launchpad-utils').Logger} logger
   */
	constructor(logger) {
		this._logger = logger;
	}

	/**
   * @param {import('../monitor-config.js').ResolvedAppConfig} appConfig
   */
	initAppLogging(appConfig) {
		const appName = appConfig.pm2.name;
		if (!appName) {
			this._logger.error('App config is missing name:', appConfig);
			return;
		}

		this._appConfigs.set(appName, appConfig);

		if (appConfig.logging.mode === LogModes.TailLogFile) {
			this._setupFileTailing(appConfig);
		}
	}

	/**
   * @private
   * @param {import('../monitor-config.js').ResolvedAppConfig} appConfig
   */
	_setupFileTailing(appConfig) {
		const appName = appConfig.pm2.name;
		if (!appName) return;

		const outFilepath = appConfig.pm2.output;
		const errFilepath = appConfig.pm2.error;
		
		const tailOptions = {
			useWatchFile: true,
			fsWatchOptions: { interval: 100 }
		};

		if (outFilepath && appConfig.logging.showStdout) {
			this._logger.debug(`Tailing stdout from ${outFilepath}`);
			const outTail = new Tail(outFilepath, tailOptions);
			outTail.on('line', (data) => {
				if (typeof data === 'string') {
					this._handleTailOutput(appName, data);
				}
			});
			outTail.on('error', (data) => {
				if (typeof data === 'string') {
					this._handleTailError(appName, data, true);
				}
			});
			outTail.watch();
			this._outTails.set(appName, outTail);
		}

		if (errFilepath && appConfig.logging.showStderr) {
			this._logger.debug(`Tailing stderr from ${errFilepath}`);
			const errTail = new Tail(errFilepath, tailOptions);
			errTail.on('line', (data) => {
				if (typeof data === 'string') {
					this._handleTailError(appName, data);
				}
			});
			errTail.on('error', (data) => {
				if (typeof data === 'string') {
					this._handleTailError(appName, data, true);
				}
			});
			errTail.watch();
			this._errTails.set(appName, errTail);
		}
	}

	/**
   * @returns {ResultAsync<void, Error>}
   */
	connect() {
		this._logger.debug('Connecting to PM2 bus');
		
		return ResultAsync.fromPromise(
			new Promise((resolve, reject) => {
				pm2.launchBus((err, bus) => {
					if (err) reject(err);
					else resolve(bus);
				});
			}).then(bus => {
				this._bus = bus;
				if (this._bus) {
					this._bus.on('*', this._handleBusEvent.bind(this));
					return;
				}
				throw new Error('Failed to connect to PM2 bus');
			}),
			(error) => error instanceof Error ? error : new Error('Unknown error connecting to PM2 bus')
		);
	}

	/**
   * @returns {ResultAsync<void, Error>}
   */
	disconnect() {
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => {
				if (this._bus) {
					this._logger.debug('Disconnecting from PM2 bus');
					this._bus.off('*');
					this._bus = null;
				}

				// Clean up file tails
				for (const [appName, tail] of this._outTails) {
					tail.unwatch();
					this._outTails.delete(appName);
				}
				for (const [appName, tail] of this._errTails) {
					tail.unwatch();
					this._errTails.delete(appName);
				}
			}),
			(error) => error instanceof Error ? error : new Error('Unknown error disconnecting from PM2 bus')
		);
	}

	/**
   * @param {(eventType: string, eventData: any) => void} handler
   */
	addEventHandler(handler) {
		this._eventHandlers.add(handler);
	}

	/**
   * @param {(eventType: string, eventData: any) => void} handler
   */
	removeEventHandler(handler) {
		this._eventHandlers.delete(handler);
	}

	/**
   * @private
   * @param {string} eventType 
   * @param {*} eventData
   */
	_handleBusEvent(eventType, eventData) {
		try {
			if (!eventData?.process?.name) {
				return;
			}

			const appName = eventData.process.name;
			const appConfig = this._appConfigs.get(appName);
			
			if (!appConfig) {
				return;
			}

			// Handle process events
			if (eventType === 'process:event') {
				if (eventData.event === 'online') {
					this._handleProcessOnline(appName);
				} else if (eventData.event === 'exit') {
					this._handleProcessExit(appName);
				}
			}

			// Handle log events for bus mode
			if (appConfig.logging.mode === LogModes.LogBusEvents) {
				if (eventType === 'log:out' && appConfig.logging.showStdout) {
					this._handleBusLogOut(appName, eventData);
				} else if (eventType === 'log:err' && appConfig.logging.showStderr) {
					this._handleBusLogErr(appName, eventData);
				}
			}

			// Notify other handlers
			for (const handler of this._eventHandlers) {
				handler(eventType, eventData);
			}
		} catch (error) {
			this._logger.error('Error handling bus event:', error);
		}
	}

	/**
   * @private
   * @param {string} appName
   */
	_handleProcessOnline(appName) {
		const appConfig = this._appConfigs.get(appName);
		if (appConfig?.logging.mode === LogModes.TailLogFile) {
			this._setupFileTailing(appConfig);
		}
	}

	/**
   * @private
   * @param {string} appName
   */
	_handleProcessExit(appName) {
		const outTail = this._outTails.get(appName);
		if (outTail) {
			outTail.unwatch();
			this._outTails.delete(appName);
		}

		const errTail = this._errTails.get(appName);
		if (errTail) {
			errTail.unwatch();
			this._errTails.delete(appName);
		}
	}

	/**
   * @private
   * @param {string} appName
   * @param {string} data
   */
	_handleTailOutput(appName, data) {
		const appLogger = LogManager.getLogger(appName, this._logger);
		appLogger.info(data);
	}

	/**
   * @private
   * @param {string} appName
   * @param {string} data
   * @param {boolean} [isTailError=false]
   */
	_handleTailError(appName, data, isTailError = false) {
		const appLogger = LogManager.getLogger(appName, this._logger);
		appLogger.error(data);
	}

	/**
   * @private
   * @param {string} appName
   * @param {*} event
   */
	_handleBusLogOut(appName, event) {
		const appLogger = LogManager.getLogger(appName, this._logger);
		this._splitLines(event.data.toString()).forEach((line) => {
			appLogger.info(line);
		});
	}

	/**
   * @private
   * @param {string} appName
   * @param {*} event
   */
	_handleBusLogErr(appName, event) {
		const appLogger = LogManager.getLogger(appName, this._logger);
		this._splitLines(event.data.toString()).forEach((line) => {
			appLogger.error(line);
		});
	}

	/**
   * @private
   * @param {string} buffer
   * @returns {string[]}
   */
	_splitLines(buffer) {
		const parts = buffer.split(/[\r]{0,1}\n/);
		parts.pop(); // last item will always be an empty string because every line ends with a carriage return
		return parts;
	}
}
