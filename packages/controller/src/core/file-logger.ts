import path from "node:path";
import { formatWithOptions } from "node:util";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type {
	LogEventPayload,
	Logger,
	LogLevel as LoggerLevel,
} from "@bluecadet/launchpad-utils/logger";
import {
	eventToLogEntry,
	isSelectedOperationalLogEvent,
	type LoggerSource,
	type LogLevel,
	type NormalizedLogRecord,
	normalizeLogRecord,
	normalizeStructuredValue,
	type ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { err, ok, Result } from "neverthrow";
import { LEVEL, MESSAGE, SPLAT } from "triple-beam";
import winston from "winston";
import Transport from "winston-transport";
import { z } from "zod";
import {
	createLogFileSource,
	type LogFileSourceOptions,
	type LogFileSourceOwner,
} from "./log-file-source.js";

const DEFAULT_SEGMENT_SIZE = "8m";
const DEFAULT_DATE_PATTERN = "YYYY-MM-DD";
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

const FILE_LOG_LEVELS = ["error", "warn", "info", "debug", "verbose"] as const;

const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
	error: 0,
	warn: 1,
	info: 2,
	event: 2,
	verbose: 3,
	debug: 4,
};

const DEFAULT_FILE_LOG_FORMAT = winston.format.combine(
	winston.format.printf((info) => {
		const moduleSuffix = info.module ? ` (${String(info.module)})` : "";
		return `${info.timestamp} ${info.level}:${moduleSuffix} ${info.message}`;
	}),
	winston.format.uncolorize(),
);

const textLogConfigSchema = z
	.object({
		enabled: z.boolean().default(true).describe("Whether to write the human-readable log view."),
		level: z
			.enum(FILE_LOG_LEVELS)
			.default("info")
			.describe("The least severe level included in the human-readable log view."),
	})
	.prefault({});

export const logConfigSchema = z
	.object({
		/** The format for the optional human-readable log view. Canonical JSONL is unaffected. */
		format: z
			.any()
			.default(DEFAULT_FILE_LOG_FORMAT)
			.describe("The Winston format for the human-readable log view."),
		/** The directory where controller-owned log files are stored. */
		dirname: z.string().default(".logs").describe("The directory where log files are stored."),
		/** Legacy segment size setting, now applied to the canonical source when it can be parsed. */
		maxSize: parsedLimitSchema(
			parseByteSize,
			1_024,
			"logging.maxSize must be at least 1024 bytes, such as '8m'",
		)
			.prefault(DEFAULT_SEGMENT_SIZE)
			.describe("The target size of each log segment."),
		/** Legacy age-retention setting. Count-based values are no longer supported. */
		maxFiles: parsedLimitSchema(
			parseMaxAge,
			1,
			"logging.maxFiles must be an age in days such as '28d'",
		)
			.prefault("28d")
			.describe("How long retained log segments are kept."),
		/** Retained for configuration compatibility; source segment names are owner-managed. */
		datePattern: z
			.string()
			.default(DEFAULT_DATE_PATTERN)
			.describe("Legacy human log filename date pattern."),
		/** Optional human-readable view. Canonical JSONL remains enabled. */
		text: textLogConfigSchema,
		/** Whether to override the console methods. */
		overrideConsole: z
			.boolean()
			.default(process.env.NODE_ENV !== "test")
			.describe("Whether to override the console methods."),
	})
	.prefault({});

export type ResolvedLogConfig = z.output<typeof logConfigSchema>;

type LogFileSourceFactory = (options: LogFileSourceOptions) => Result<LogFileSourceOwner, Error>;

export interface FileLoggerDependencies {
	readonly createSource?: LogFileSourceFactory;
	readonly closeTimeoutMs?: number;
}

export interface ControllerFileLogger {
	readonly logger: Logger;
	readonly source?: LoggerSource;
	recordEvent(event: string, payload: unknown): void;
	close(): Promise<void>;
}

type LogInfo = Record<string | symbol, unknown> & {
	level: string;
	message: unknown;
};

function isLogInfo(value: unknown): value is LogInfo {
	return (
		value !== null &&
		typeof value === "object" &&
		"level" in value &&
		typeof value.level === "string" &&
		"message" in value
	);
}

function isLoggerLevel(value: string): value is LoggerLevel {
	return FILE_LOG_LEVELS.some((level) => level === value);
}

function createEventPayload(info: LogInfo): LogEventPayload {
	const splat = info[SPLAT];
	const args = [info.message, ...(Array.isArray(splat) ? splat : [])];
	const module = typeof info.module === "string" ? info.module : undefined;

	return {
		message: formatWithOptions({ colors: false, compact: true }, ...args),
		args,
		...(module === undefined ? {} : { module }),
	};
}

function parseByteSize(value: string): number | undefined {
	const match = /^\s*(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?\s*$/i.exec(value);
	if (!match) return undefined;

	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	const unit = match[2]?.toLowerCase() ?? "b";
	const multiplier =
		unit === "g" || unit === "gb"
			? 1024 ** 3
			: unit === "m" || unit === "mb"
				? 1024 ** 2
				: unit === "k" || unit === "kb"
					? 1024
					: 1;
	const bytes = Math.floor(amount * multiplier);
	return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

function parseMaxAge(value: string): number | undefined {
	const match = /^\s*(\d+(?:\.\d+)?)\s*d\s*$/i.exec(value);
	if (!match) return undefined;
	const days = Number(match[1]);
	if (!Number.isFinite(days) || days <= 0) return undefined;
	const milliseconds = Math.floor(days * 24 * 60 * 60 * 1_000);
	return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

function parsedLimitSchema(
	parse: (value: string) => number | undefined,
	minimum: number,
	message: string,
) {
	return z.string().transform((value, context) => {
		const parsed = parse(value);
		if (parsed === undefined || parsed < minimum) {
			context.addIssue({ code: "custom", message });
			return z.NEVER;
		}
		return parsed;
	});
}

function normalizeCanonicalRecord(
	event: string,
	payload: unknown,
	resource: ResourceAttributes,
): Result<NormalizedLogRecord, Error> {
	return Result.fromThrowable(() => eventToLogEntry(event, payload), ensureError)()
		.andThen((entry) => normalizeLogRecord(entry, resource))
		.andThen((record) => {
			const args = record.metadata.args;
			if (!event.startsWith("log:") || !Array.isArray(args)) return ok(record);
			// Format only redacted arguments; preserve the separate legacy bus message.
			return Result.fromThrowable(
				() =>
					normalizeStructuredValue(formatWithOptions({ colors: false, compact: true }, ...args)),
				ensureError,
			)().andThen((message) =>
				typeof message === "string"
					? ok(Object.freeze({ ...record, message }))
					: err(new Error("Unable to normalize the log message")),
			);
		});
}

function shouldRenderText(record: NormalizedLogRecord, config: ResolvedLogConfig): boolean {
	if (!config.text.enabled) return false;
	return LOG_LEVEL_PRIORITY[record.level] <= LOG_LEVEL_PRIORITY[config.text.level];
}

function formatLogTimestamp(timestamp: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}-${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`;
}

function normalizedFormatInfo(record: NormalizedLogRecord): LogInfo {
	// Winston formats are allowed to mutate their info object. Give them an isolated
	// normalized copy so a custom text formatter cannot alter the canonical record.
	const metadata = structuredClone(record.metadata);
	const normalizedArgs = metadata.args;
	return {
		...metadata,
		schemaVersion: record.schemaVersion,
		event: record.event,
		level: record.level,
		message: record.message,
		...(record.module === undefined ? {} : { module: record.module }),
		metadata,
		resource: structuredClone(record.resource),
		timestamp: formatLogTimestamp(record.timestamp),
		[LEVEL]: record.level,
		...(Array.isArray(normalizedArgs) ? { [SPLAT]: normalizedArgs } : {}),
	};
}

function renderTextLine(
	record: NormalizedLogRecord,
	config: ResolvedLogConfig,
): Result<string, Error> {
	return Result.fromThrowable(
		(): unknown => config.format.transform(normalizedFormatInfo(record), config.format.options),
		ensureError,
	)().andThen((transformed) => {
		if (!isLogInfo(transformed))
			return err(new Error("The configured text log format did not produce a log record"));
		return Result.fromThrowable(() => {
			const rendered = transformed[MESSAGE];
			return typeof rendered === "string" ? rendered : String(transformed.message);
		}, ensureError)();
	});
}

class ControllerLogTransport extends Transport {
	constructor(
		private readonly eventBus: EventBus,
		private readonly record: (event: string, payload: LogEventPayload) => void,
	) {
		super({ level: "debug" });
	}

	override log(info: unknown, callback: () => void): void {
		if (!isLogInfo(info) || !isLoggerLevel(info.level)) {
			callback();
			return;
		}

		const payload = createEventPayload(info);
		this.record(`log:${info.level}`, payload);
		this.eventBus.emit(`log:${info.level}`, payload);
		callback();
	}
}

function proxyChildMethod(logger: winston.Logger): Logger {
	return new Proxy(logger, {
		get(target, property, receiver) {
			if (property === "child") {
				return (module: string): Logger => proxyChildMethod(target.child({ module }));
			}
			return Reflect.get(target, property, receiver);
		},
	});
}

function bindConsoleToLogger(logger: winston.Logger): void {
	const consoleLogger = logger.child({ module: "console" });
	console.log = consoleLogger.verbose.bind(consoleLogger);
	console.info = consoleLogger.verbose.bind(consoleLogger);
	console.warn = consoleLogger.warn.bind(consoleLogger);
	console.error = consoleLogger.error.bind(consoleLogger);
	console.debug = consoleLogger.verbose.bind(consoleLogger);
	Object.freeze(console);
}

function createDiagnosticReporter(eventBus: EventBus): (message: string) => void {
	const reported = new Set<string>();
	const warn = console.warn.bind(console);
	return (message: string): void => {
		if (reported.has(message)) return;
		reported.add(message);
		warn(`[launchpad logging] ${message}`);
		eventBus.emit("log:warn", {
			message,
			args: [message],
			module: "logging",
		});
	};
}

function appendEntry(
	owner: LogFileSourceOwner | undefined,
	config: ResolvedLogConfig,
	event: string,
	payload: unknown,
	reportDiagnostic: (message: string) => void,
): void {
	if (!owner) return;

	const normalized = normalizeCanonicalRecord(event, payload, owner.source.resourceAttributes);
	if (normalized.isErr()) {
		reportDiagnostic(`Unable to normalize a canonical log record: ${normalized.error.message}`);
		return;
	}
	const record = normalized.value;
	let textLine: string | undefined;
	if (shouldRenderText(record, config)) {
		const rendered = renderTextLine(record, config);
		if (rendered.isOk()) textLine = rendered.value;
		else
			reportDiagnostic(`Unable to format the human-readable log view: ${rendered.error.message}`);
	}
	// The source owns accurate diagnostics (closing, capacity, or serialization).
	owner.append(record, textLine);
}

/**
 * Create the controller logger and its optional durable source.
 *
 * Logger calls remain synchronous: records are normalized once and admitted to
 * the source's bounded queue without awaiting filesystem I/O. Source startup or
 * I/O failures are reported on the in-process bus and never prevent controller
 * construction.
 */
export function createFileLogger(
	config: ResolvedLogConfig,
	cwd: string,
	eventBus: EventBus,
	dependencies: FileLoggerDependencies = {},
): ControllerFileLogger {
	const reportDiagnostic = createDiagnosticReporter(eventBus);
	const createSource = dependencies.createSource ?? createLogFileSource;
	let owner: LogFileSourceOwner | undefined;
	if (config.datePattern !== DEFAULT_DATE_PATTERN) {
		reportDiagnostic(
			"logging.datePattern is deprecated and no longer controls owner-managed log filenames",
		);
	}

	const created = Result.fromThrowable(
		() =>
			createSource({
				directory: path.resolve(cwd, config.dirname),
				maxSegmentBytes: config.maxSize,
				maxBytes: DEFAULT_MAX_BYTES,
				maxAgeMs: config.maxFiles,
				onDiagnostic: reportDiagnostic,
			}),
		ensureError,
	)().andThen((result) => result);
	if (created.isOk()) owner = created.value;
	else reportDiagnostic(`File-backed logging is unavailable: ${created.error.message}`);

	const record = (event: string, payload: unknown): void => {
		appendEntry(owner, config, event, payload, reportDiagnostic);
	};
	const winstonLogger = winston.createLogger({
		level: "debug",
		transports: [new ControllerLogTransport(eventBus, record)],
	});

	if (config.overrideConsole) bindConsoleToLogger(winstonLogger);

	let closePromise: Promise<void> | undefined;
	return {
		logger: proxyChildMethod(winstonLogger),
		...(owner === undefined ? {} : { source: owner.source }),
		recordEvent(event: string, payload: unknown): void {
			if (!isSelectedOperationalLogEvent(event)) return;
			record(event, payload);
		},
		close(): Promise<void> {
			if (closePromise) return closePromise;
			if (!owner) return Promise.resolve();

			const timeout = dependencies.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
			const pendingClose = Promise.resolve(owner.close(AbortSignal.timeout(timeout))).then(
				(result) => {
					if (result.isErr())
						reportDiagnostic(`File-backed logging did not close cleanly: ${result.error.message}`);
				},
			);
			closePromise = pendingClose;
			return pendingClose;
		},
	};
}
