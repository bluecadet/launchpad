import path from "node:path";
import winston, { type Logger as WinstonLogger } from "winston";
import "winston-daily-rotate-file";
import slugify from "@sindresorhus/slugify";
import chalk from "chalk";
import moment from "moment";
import { z } from "zod";
import { CustomConsoleTransport, FilterLogType } from "./console-transport.js";

export type Logger = Pick<WinstonLogger, "info" | "warn" | "error" | "debug" | "once" | "close" | "log"> & {
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

const logFileConfigSchema = z.object({
	/** The format for how each line is logged. This should be a winston.Logform.Format class instance. */
	format: z.any().default(DEFAULT_LOG_FORMAT).describe("The format for how each line is logged."), // TODO: z.instanceOf(Format) is not working... Looks like logform types are broken.
	/** The extension for the log files. */
	extension: z.string().default(".log").describe("The extension for the log files."),
	/** The directory where log files are stored. */
	dirname: z.string().default(".logs").describe("The directory where log files are stored."),
	/** The maximum size of each log file. */
	maxSize: z.string().default("20m").describe("The maximum size of each log file."),
	/** The maximum number of log files to keep. */
	maxFiles: z.string().default("28d").describe("The maximum number of log files to keep."),
	/** The pattern for the date in the log file name. */
	datePattern: z
		.string()
		.default(FILE_TIMESTAMP_FORMAT)
		.describe("The pattern for the date in the log file name."),
});

export const logConfigSchema = z.object({
	/** The filename for the log files. */
	filename: z
		.string()
		.default(`${DATE_KEY}-${LOG_TYPE_KEY}`)
		.describe("The filename for the log files."),
	/** The options for the log files. */
	fileOptions: logFileConfigSchema.default({}).describe("The options for the log files."),
	/** The log level for the logger. */
	level: z.string().default("info").describe("The log level for the logger."),
	/** The format for how each line is logged in the console. This should be a winston.Logform.Format class instance. */
	format: z
		.any()
		.default(DEFAULT_LOG_FORMAT)
		.describe("The format for how each line is logged in the console."),
	/** Whether to override the console methods. */
	overrideConsole: z
		.boolean()
		.default(process.env.NODE_ENV !== "test")
		.describe("Whether to override the console methods."),
});

export type LogConfig = z.input<typeof logConfigSchema>;
export type ResolvedLogConfig = z.output<typeof logConfigSchema>;

export class LogManager {
	/** @internal */
	static _instance: LogManager | null = null;
	private _config: ResolvedLogConfig;
	private _rootLogger: WinstonLogger;

	constructor(config: LogConfig = {}) {
		this._config = logConfigSchema.parse(config);

		this._rootLogger = winston.createLogger({
			...this._config,
			transports: [
				new CustomConsoleTransport({
					level: this._config.level,
					format: new FilterLogType("tty"),
				}),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					format: winston.format.combine(this._config.fileOptions.format, new FilterLogType("file")),
					filename: this.getFilePath("launchpad-info", false),
					level: "info",
				}),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					format: winston.format.combine(this._config.fileOptions.format, new FilterLogType("file")),
					filename: this.getFilePath("launchpad-debug", false),
					level: "debug",
				}),
				new winston.transports.DailyRotateFile({
					...this._config.fileOptions,
					format: winston.format.combine(this._config.fileOptions.format, new FilterLogType("file")),
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
