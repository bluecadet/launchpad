import path from "node:path";
import winston, { type Logger as WinstonLogger } from "winston";
import "winston-daily-rotate-file";
import slugify from "@sindresorhus/slugify";
import chalk from "chalk";
import moment from "moment";

export type Logger = Pick<WinstonLogger, "info" | "warn" | "error" | "debug" | "once" | "close"> & {
	child: (options: Parameters<WinstonLogger["child"]>[0]) => Logger;
};

const DATE_KEY = "%DATE%";
const LOG_TYPE_KEY = "%LOG_TYPE%";
const LOG_TIMESTAMP_FORMAT = "YYYY-MM-DD-HH:mm:ss";
const FILE_TIMESTAMP_FORMAT = "YYYY-MM-DD";

const DEFAULT_LOG_FORMAT = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({
		format: LOG_TIMESTAMP_FORMAT,
	}),
	winston.format.printf((info) => {
		const moduleStr = info.module ? chalk.gray(` (${info.module})`) : "";
		return `${info.timestamp} ${info.level}:${moduleStr} ${info.message}`;
	}),
);

interface LogFileConfig {
	format?: winston.Logform.Format;
	extension?: string;
	dirname?: string;
	maxSize?: string;
	maxFiles?: string;
	datePattern?: string;
}

const LOG_FILE_CONFIG_DEFAULTS = {
	format: DEFAULT_LOG_FORMAT,
	extension: ".log",
	dirname: ".logs",
	maxSize: "20m",
	maxFiles: "28d",
	datePattern: FILE_TIMESTAMP_FORMAT,
};

interface ResolvedLogFileConfig {
	format: winston.Logform.Format;
	extension: string;
	dirname: string;
	maxSize: string;
	maxFiles: string;
	datePattern: string;
}

interface LaunchpadLogConfig {
	filename?: string;
	fileOptions?: LogFileConfig;
	level?: string;
	format?: winston.Logform.Format;
	overrideConsole?: boolean;
}

export type LogConfig = LaunchpadLogConfig & Omit<winston.LoggerOptions, keyof LaunchpadLogConfig>;

const LOG_OPTIONS_DEFAULTS = {
	filename: `${DATE_KEY}-${LOG_TYPE_KEY}`,
	fileOptions: LOG_FILE_CONFIG_DEFAULTS,
	level: "info",
	format: DEFAULT_LOG_FORMAT,
	overrideConsole: process.env.NODE_ENV !== "test",
} as const;

// Define the resolved config type first
interface ResolvedLogConfig {
	filename: string;
	fileOptions: ResolvedLogFileConfig;
	level: string;
	format: winston.Logform.Format;
	overrideConsole: boolean;
}

function resolveLogConfig(config?: LogConfig): ResolvedLogConfig {
	return {
		...LOG_OPTIONS_DEFAULTS,
		...config,
		fileOptions: {
			...LOG_FILE_CONFIG_DEFAULTS,
			...config?.fileOptions,
		},
	};
}

export class LogManager {
	/** @internal */
	static _instance: LogManager | null = null;
	private _config: ResolvedLogConfig;
	private _rootLogger: WinstonLogger;

	constructor(config?: LogConfig) {
		this._config = resolveLogConfig(config);
		this._rootLogger = winston.createLogger({
			...this._config,
			transports: [
				new winston.transports.Console({ level: this._config.level }),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					filename: this.getFilePath("launchpad-info", false),
					level: "info",
				}),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					filename: this.getFilePath("launchpad-debug", false),
					level: "debug",
				}),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					filename: this.getFilePath("launchpad-error", false),
					level: "error",
				}),
			],
		});

		if (this._config.overrideConsole) {
			this.#overrideConsoleMethods();
		}
	}

	static getInstance(): LogManager {
		if (LogManager._instance === null) {
			throw new Error("Root logger not configured");
		}
		return LogManager._instance;
	}

	static configureRootLogger(config?: LogConfig): WinstonLogger {
		if (LogManager._instance === null) {
			LogManager._instance = new LogManager(config);
		} else {
			LogManager._instance._rootLogger.warn("Root logger already configured. Ignoring.");
		}

		return LogManager._instance._rootLogger;
	}

	static getLogger(moduleName?: string, parent?: Logger): Logger {
		const parentLogger = parent ?? LogManager.getInstance()._rootLogger;

		if (moduleName) {
			const child = parentLogger.child({ module: moduleName });
			parentLogger.once("close", () => child.close());
			return child;
		}

		return parentLogger;
	}

	getChildLogger(moduleName?: string): Logger {
		return LogManager.getLogger(moduleName, this._rootLogger);
	}

	getFilePath(logType: string, templated = true): string {
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

	#overrideConsoleMethods(): void {
		const logger = this.getChildLogger("console");
		console.log = logger.info.bind(logger);
		console.info = logger.info.bind(logger);
		console.warn = logger.warn.bind(logger);
		console.error = logger.error.bind(logger);
		console.debug = logger.debug.bind(logger);

		Object.freeze(console);
	}
}
