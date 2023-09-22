/**
 * @module log-manager
 */

import path from 'path';
import winston, { Logger } from 'winston';
import 'winston-daily-rotate-file';
import slugify from '@sindresorhus/slugify';
import moment from 'moment';
import chalk from 'chalk';

export { Logger };

const DATE_KEY = '%DATE%';
const LOG_TYPE_KEY = '%LOG_TYPE%';
const LOG_TIMESTAMP_FORMAT = 'YYYY-MM-DD-HH:mm:ss';
const FILE_TIMESTAMP_FORMAT = 'YYYY-MM-DD';
const DEFAULT_LOG_FORMAT = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({
		format: LOG_TIMESTAMP_FORMAT
	}),
	winston.format.printf(info => {
		const moduleStr = info.module ? chalk.gray(` (${info.module})`) : '';
		return `${info.timestamp} ${info.level}:${moduleStr} ${info.message}`;
	})
);

/**
 * @typedef LogFileOptions see https://github.com/winstonjs/winston-daily-rotate-file#options 
 * @property {winston.Logform.Format} [format] The format used for individual file logs. Defaults to `YYYY-MM-DD-HH:mm:ss (level):(module) message`.
 * @property {string} [extension] File extension. Defaults to '.log'.
 * @property {string} [dirname] The directory under which all logs are saved. Defaults to '.logs'.
 * @property {string} [maxSize] The max size of each individual log file. Defaults to '20m'.
 * @property {string} [maxFiles] The maximum number of files to save per type. Defaults to '28d'.
 * @property {string} [datePattern] The date pattern used in file names. Defaults to 'YYYY-MM-DD'.
 */

/**
 * @satisfies {LogFileOptions}
 */
const LOG_FILE_OPTIONS_DEFAULTS = {
	format: DEFAULT_LOG_FORMAT,
	extension: '.log',
	dirname: '.logs',
	maxSize: '20m',
	maxFiles: '28d',
	datePattern: FILE_TIMESTAMP_FORMAT
};

/**
 * @typedef {typeof LOG_FILE_OPTIONS_DEFAULTS & Omit<LogFileOptions, keyof typeof LOG_FILE_OPTIONS_DEFAULTS>} ResolvedLogFileOptions 
 */

/**
 * @typedef LaunchpadLogOptions 
 * @property {string} [filename] Where to save logs to. Defaults to `%DATE%-%LOG_TYPE%`.
 * @property {LogFileOptions} [fileOptions] Options for individual files and streams.
 * @property {string} [level] The maximum log level to display in all default logs. Defaults to 'info'.
 * @property {winston.Logform.Format} [format] The format for how each line is logged. Defaults to a colorized version of `YYYY-MM-DD-HH:mm:ss (level):(module) message`.
 * @property {boolean} [overrideConsole] Route all console logs to the log manager. This helps ensure that logs are routed to files and rotated properly. This will also freeze the console object, so it can't be modified further during runtime. All console logs will be prefixed with `(console)`. Defaults to true.
 */

/**
 * @typedef {LaunchpadLogOptions & Omit<winston.LoggerOptions, keyof LaunchpadLogOptions>} LogOptions Options object passed directly to Winston's constructor, with additional options for Launchpad logging. See https://github.com/winstonjs/winston#creating-your-own-logger for all available settings supported by Winston.
 */

/**
 * @satisfies {LogOptions}
 */
const LOG_OPTIONS_DEFAULTS = {
	filename: `${DATE_KEY}-${LOG_TYPE_KEY}`,
	fileOptions: LOG_FILE_OPTIONS_DEFAULTS,
	level: 'info',
	format: DEFAULT_LOG_FORMAT,
	overrideConsole: true
};

/**
 * @param {LogOptions} [options] 
 */
function resolveLogOptions(options) {
	return {
		...LOG_OPTIONS_DEFAULTS,
		...options,
		fileOptions: {
			...LOG_FILE_OPTIONS_DEFAULTS,
			...options?.fileOptions
		}
	};
}

/**
 * @typedef {ReturnType<typeof resolveLogOptions>} ResolvedLogOptions
 */

export class LogManager {
	/**
	 * @type {LogManager | null}
	 */
	static _instance = null;
	
	/**
	 * @param {LogOptions} [config] 
	 * @returns {LogManager}
	 */
	static getInstance(config) {
		if (this._instance === null) {
			this._instance = new LogManager(config);
		}
		return this._instance;
	}
	
	/**
	 * @type {ResolvedLogOptions}
	 */
	_config;
	
	/**
	 * @type {Logger}
	 */
	_logger;
	
	/**
	 * @param {LogOptions} [config] 
	 */
	constructor(config) {
		this._config = resolveLogOptions(config);
		this._logger = winston.createLogger({
			...this._config,
			transports: [
				new winston.transports.Console({ level: this._config.level }),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-info', false), level: 'info' }),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-debug', false), level: 'debug' }),
				new winston.transports.DailyRotateFile({ ...this._config.fileOptions, filename: this.getFilePath('launchpad-error', false), level: 'error' })
			]
		});
		
		if (this._config.overrideConsole) {
			this.overrideConsoleMethods();
		}
	}
	
	/**
	 * @param {string} [moduleName] If defined, will create a child logger with the specified module name. The child logger is automatically ended when the parent logger ends.
	 * @param {Logger} [parent] The parent logger to create this logger from (if a moduleName is specified). Will default to the main logger instance if left empty.
	 * @returns {Logger}
	 */
	getLogger(moduleName, parent) {
		if (moduleName) {
			parent = parent || this._logger;
			const child = parent.child({ module: moduleName });
			parent.once('close', () => child.close());
			return child;
		} else {
			return this._logger;
		}
	}
	
	/**
	 * @param {string} logType
	 * @param {boolean} templated
	 */
	getFilePath(logType, templated = true) {
		let output = this._config.filename.replace(LOG_TYPE_KEY, logType);
		if (templated) {
			const dateStr = moment().format(FILE_TIMESTAMP_FORMAT);
			output = output.replace(DATE_KEY, dateStr);
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
