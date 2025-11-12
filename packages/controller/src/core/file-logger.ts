import path from "node:path";
import winston from "winston";
import "winston-daily-rotate-file";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import chalk from "chalk";
import { LEVEL, MESSAGE } from "triple-beam";
import Transport from "winston-transport";
import { z } from "zod";
import type { EventBus } from "./event-bus.js";

const LOG_TIMESTAMP_FORMAT = "YYYY-MM-DD-HH:mm:ss";
const FILE_TIMESTAMP_FORMAT = "YYYY-MM-DD";

const DEFAULT_FILE_LOG_FORMAT = winston.format.combine(
	winston.format.timestamp({
		format: LOG_TIMESTAMP_FORMAT,
	}),
	winston.format.printf((info) => {
		const moduleStr = info.module ? chalk.gray(` (${info.module})`) : "";
		return `${info.timestamp} ${info.level}:${moduleStr} ${info.message}`;
	}),
	winston.format.uncolorize(),
);

export const logConfigSchema = z
	.object({
		/** The format for how each line is logged. This should be a winston.Logform.Format class instance. */
		format: z
			.any()
			.default(DEFAULT_FILE_LOG_FORMAT)
			.describe("The format for how each line is logged."), // TODO: z.instanceOf(Format) is not working... Looks like logform types are broken.
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
		/** Whether to override the console methods. */
		overrideConsole: z
			.boolean()
			.default(process.env.NODE_ENV !== "test")
			.describe("Whether to override the console methods."),
	})
	.default({});

export type LogConfig = z.input<typeof logConfigSchema>;
export type ResolvedLogConfig = z.output<typeof logConfigSchema>;

type LogLevel = "info" | "warn" | "error" | "debug";

class EventBusTransport extends Transport {
	constructor(
		private eventBus: EventBus,
		opts?: Transport.TransportStreamOptions,
	) {
		super({ ...opts, format: winston.format.json() });
	}

	override log(info: any, callback: () => void) {
		const level = info[LEVEL] as LogLevel;
		// create copy of info without LEVEL and MESSAGE, as those are internal to winston and not needed in the event payload
		const payload = { ...info };
		delete payload[LEVEL];
		delete payload[MESSAGE];
		this.eventBus.emit(`log:${level}`, payload);
		callback();
	}
}

export function createFileLogger(
	config: ResolvedLogConfig,
	cwd: string,
	eventBus: EventBus,
): Logger {
	const logDir = path.resolve(cwd, config.dirname);

	const logger = winston.createLogger({
		transports: [
			new winston.transports.DailyRotateFile({
				...config,
				dirname: logDir,
				format: config.format,
				filename: "launchpad-info",
				level: "info",
			}),
			new winston.transports.DailyRotateFile({
				...config,
				dirname: logDir,
				format: config.format,
				filename: "launchpad-debug",
				level: "debug",
			}),
			new winston.transports.DailyRotateFile({
				...config,
				dirname: logDir,
				format: config.format,
				filename: "launchpad-error",
				level: "error",
			}),
			new EventBusTransport(eventBus, {
				level: "debug",
			}),
		],
	});

	// if (config.overrideConsole) {
	// 	bindConsoleToLogger(logger);
	// }

	return proxyChildMethod(logger);
}

function proxyChildMethod(logger: winston.Logger): Logger {
	return new Proxy(logger, {
		get(target, prop, receiver) {
			if (prop === "child") {
				return (module: string): Logger => {
					const childLogger = target.child({ module });
					return proxyChildMethod(childLogger);
				};
			}

			const value = Reflect.get(target, prop, receiver);
			return value;
		},
	});
}

export function bindConsoleToLogger(logger: Logger) {
	console.log = logger.info.bind(logger);
	console.info = logger.info.bind(logger);
	console.warn = logger.warn.bind(logger);
	console.error = logger.error.bind(logger);
	console.debug = logger.debug.bind(logger);

	Object.freeze(console);
}
