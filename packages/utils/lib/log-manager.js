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
		...rest
	} = {}) {
		
		// Launchpad-specific settings
		
		/**
		 * @type {string}
		 */
		this.filename = `${LogOptions.DATE_KEY}-${LogOptions.LOG_TYPE_KEY}`;
		
		/**
		 * @type {LogFileOptions}
		 */
		this.fileOptions = new LogFileOptions(fileOptions);
		
		// Winston-inherited settings
		
		/** @type {string} */
		this.level = level;
		
		/** @type {winston.Logform.Format} */
		this.format = format;
		
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
		/** @type {winston.Logform.Format} */
		this.format = format;
		/** @type {string} */
		this.extension = extension;
		/** @type {string} */
		this.dirname = dirname;
		/** @type {string} */
		this.maxSize = maxSize;
		/** @type {string} */
		this.maxFiles = maxFiles;
		/** @type {string} */
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
	
}

export default LogManager;
