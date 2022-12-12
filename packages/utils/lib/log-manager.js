/**
 * @module log-manager
 */

import path from 'path';
import winston, { loggers } from 'winston';
import Logger from 'winston/lib/winston/logger.js';
import 'winston-daily-rotate-file';
import slugify from '@sindresorhus/slugify';
import moment from 'moment';
import chalk from 'chalk';

export { Logger };

/**
 * Options object passed directly to Winston's constructor, with additional options for Launchpad logging.
 * 
 * @see https://github.com/winstonjs/winston#creating-your-own-logger for all available settings supported by Winston.
 */
export class LogOptions {
	static DATE_KEY = '%DATE%';
	static LOG_TYPE_KEY = '%LOG_TYPE%';
	static LOG_TIMESTAMP_FORMAT = 'YYYY-MM-DD-HH:mm:ss';
	static FILE_TIMESTAMP_FORMAT = 'YYYY-MM-DD';
	static DEFAULT_LOG_FORMAT = winston.format.combine(
		winston.format.colorize(),
		winston.format.timestamp({
			format: LogOptions.LOG_TIMESTAMP_FORMAT
		}),
		winston.format.printf(info => {
			const moduleStr = info.module ? chalk.gray(` (${info.module})`) : '';
			return `${info.timestamp} ${info.level}:${moduleStr} ${info.message}`;
		})
	);
	
	constructor({
		filename = `${LogOptions.DATE_KEY}-${LogOptions.LOG_TYPE_KEY}`,
		fileOptions = new LogFileOptions(),
		level = 'info',
		format = LogOptions.DEFAULT_LOG_FORMAT,
		overrideConsole = true,
		...rest
	} = {}) {
		/**
		 * Where to save logs to.
		 * @type {string}
		 * @default `%DATE%-%LOG_TYPE%`
		 */
		this.filename = `${LogOptions.DATE_KEY}-${LogOptions.LOG_TYPE_KEY}`;
		
		/**
		 * Options for individual files and streams.
		 * @type {LogFileOptions}
		 * @default new LogFileOptions(fileOptions)
		 */
		this.fileOptions = new LogFileOptions(fileOptions);
		
		/**
		 * The maximum log level to display in all default logs.
		 * @type {string}
		 * @default 'info'
		 */
		this.level = level;
		
		/**
		 * The format for how each line is logged.
		 * @type {winston.Logform.Format}
		 * @default LogOptions.DEFAULT_LOG_FORMAT
		 */
		this.format = format;
		
		/**
		 * Route all console logs to the log manager. This helps
		 * ensure that logs are routed to files and rotated properly.
		 * 
		 * This will also freeze the console object, so it can't be
		 * modified further during runtime.
		 * 
		 * All console logs will be prefixed with `(console)`.
		 * 
		 * @type {boolean}
		 * @default true
		 */
		 this.overrideConsole = true;
		
		Object.assign(this, rest);
	}
}

/**
 * @see https://github.com/winstonjs/winston-daily-rotate-file#options
 */
export class LogFileOptions {
	constructor({
		format = winston.format.combine(
			LogOptions.DEFAULT_LOG_FORMAT,
			winston.format.uncolorize()
		),
		extension = '.log',
		dirname = '.logs',
		maxSize = '20m',
		maxFiles = '28d',
		datePattern = LogOptions.FILE_TIMESTAMP_FORMAT,
		...rest
	} = {}) {
		/**
		 * The format used for individual file logs. Uses the default log format but without colorization out of the box.
		 * 
		 * @type {winston.Logform.Format}
		 * @default Uncolorized variant of LogOptions.DEFAULT_LOG_FORMAT
		 */
		this.format = format;
		
		/**
		 * File extension.
		 * 
		 * @type {string}
		 * @default '.log'
		 */
		this.extension = extension;
		
		/**
		 * The directory under which all logs are saved.
		 * 
		 * @type {string}
		 * @default '.logs'
		 */
		this.dirname = dirname;
		
		/**
		 * The max size of each individual log file.
		 * 
		 * @type {string}
		 * @default '20m'
		 */
		this.maxSize = maxSize;
		
		/**
		 * The maximum number of files to save per type.
		 * 
		 * @type {string}
		 * @default '28d'
		 */
		this.maxFiles = maxFiles;
		
		/**
		 * The date pattern used in file names.
		 * 
		 * @type {string}
		 * @default 'YYYY-MM-DD'
		 */
		this.datePattern = datePattern;
		Object.assign(this, rest);
	}
}

class LogManager {
	/**
	 * @type {LogManager}
	 */
	static _instance = null;
	
	/**
	 * @param {LogOptions|Object} config 
	 * @returns {LogManager}
	 */
	static getInstance(config) {
		if (this._instance === null) {
			this._instance = new LogManager(config);
		}
		return this._instance;
	}
	
	/**
	 * @type {LogOptions}
	 */
	_config = null;
	
	/**
	 * @type {Logger}
	 */
	_logger = null;
	
	/**
	 * @param {LogOptions|Object} config 
	 */
	constructor(config) {
		this._config = new LogOptions(config);
		this._logger = winston.createLogger({
			...this._config,
			transports: [
				new winston.transports.Console({ level: this._config.level }),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-info', false), level: 'info'}),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-debug', false), level: 'debug'}),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-error', false), level: 'error'}),
			],
		});
		
		if (this._config.overrideConsole) {
			this.overrideConsoleMethods();
		}
	}
	
	/**
	 * @param {string} moduleName If defined, will create a child logger with the specified module name. The child logger is automatically ended when the parent logger ends.
	 * @param {Logger} parent The parent logger to create this logger from (if a moduleName is specified). Will default to the main logger instance if left empty.
	 * @returns {Logger}
	 */
	getLogger(moduleName = null, parent = null) {
		if (moduleName) {
			parent = parent || this._logger;
			const child = parent.child({module: moduleName});
			parent.once('close', () => child.close());
			return child;
		} else {
			return this._logger;
		}
	}
	
	getFilePath(logType, templated = true) {
		let output = this._config.filename.replace(LogOptions.LOG_TYPE_KEY, logType);
		if (templated) {
			const dateStr = moment().format(LogOptions.FILE_TIMESTAMP_FORMAT);
			output = output.replace(LogOptions.DATE_KEY, dateStr);
			output = slugify(output);
			output = output + this._config.fileOptions.extension;
			output = path.join(this._config.fileOptions.dirname, output);
		}
		return output;
	}


	/**
	 * Overrides console methods to use the parent logger instead
	 * @private
	 */
	overrideConsoleMethods() {	
		// Override console methods
		const logger = this.getLogger('console');
		console.log = logger.info.bind(logger);
		console.info = logger.info.bind(logger);
		console.warn = logger.warn.bind(logger);
		console.error = logger.error.bind(logger);
		console.debug = logger.debug.bind(logger);

		// PM2 will try to override the console methods with it's own logger
		// so we're freezing console here to prevent that from happening
		Object.freeze(console);
	}
	
}

export default LogManager;
