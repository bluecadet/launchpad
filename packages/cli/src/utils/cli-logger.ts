import { sep } from "node:path";
import { formatWithOptions } from "node:util";
import type { LogEventPayload, LogLevel } from "@bluecadet/launchpad-utils/logger";
import ansiEscapes from "ansi-escapes";
import chalk, { type ChalkInstance } from "chalk";
import stringWidth from "string-width";
import { forwardLog } from "./detached-messaging.js";

const LEVEL_COLORS: { [k in LogLevel]: ChalkInstance } = {
	info: chalk.green,
	debug: chalk.cyan,
	warn: chalk.yellow,
	error: chalk.red,
	verbose: chalk.magenta,
};

const LEVEL_BG_COLORS: { [k in LogLevel]: ChalkInstance } = {
	info: chalk.bgGreen.black,
	debug: chalk.bgCyan.black,
	warn: chalk.bgYellow.black,
	error: chalk.bgRed.black,
	verbose: chalk.bgMagenta.black,
};

/**
 * Parses a stack trace string and normalises its paths by removing the current working directory and the "file://" protocol.
 * @param {string} stack - The stack trace string.
 * @returns {string[]} An array of stack trace lines with normalised paths.
 */
function parseStack(stack: string, message: string) {
	const cwd = process.cwd() + sep;

	const lines = stack
		.split("\n")
		.splice(message.split("\n").length)
		.map((l) => l.trim().replace("file://", "").replace(cwd, ""));

	return lines;
}

function formatStack(stack: string, message: string, errorLevel = 0) {
	const indent = "  ".repeat(errorLevel + 1);

	return (
		`\n${indent}` +
		parseStack(stack, message)
			.map(
				(line) =>
					"  " +
					line
						.replace(/^at +/, (m) => chalk.gray(m))
						.replace(/\((.+)\)/, (_, m) => `(${chalk.cyan(m)})`),
			)
			.join(`\n${indent}`)
	);
}

function formatErr(err: Error, errorLevel = 0): string {
	const message = err.message;
	const stack = err.stack ? formatStack(err.stack, message, errorLevel) : "";

	const level = errorLevel || 0;
	const causedPrefix = level > 0 ? `${"  ".repeat(level)}[cause]: ` : "";
	const causedError = err.cause instanceof Error ? `\n\n${formatErr(err.cause, level + 1)}` : "";

	return `${causedPrefix + message}\n${stack}${causedError}`;
}

function formatLevelPrefix(level: LogLevel, isBadge = false) {
	if (isBadge) {
		return LEVEL_BG_COLORS[level](` ${level.toUpperCase()} `);
	}

	if (level === "info" && configuredLogLevel <= LOG_LEVEL_TO_NUM.info) {
		// omit "info" prefix if the only logs shown are info level.
		// Warning and errors will still show their badged prefixes.
		return "";
	}

	return LEVEL_COLORS[level](`${level}:`);
}

function formatDate(date: Date) {
	return date.toLocaleTimeString();
}

/**
 * Splits a message into multiple lines based on the given width.
 * Preserves word boundaries where possible.
 * Respect newline characters.
 */
function splitLines(
	message: string,
	widthFirstLine: number,
	widthAdditionalLines: number,
): string[] {
	if (!message) {
		return [""];
	}

	// First split by existing newlines to respect them
	const paragraphs = message.split("\n");
	const result: string[] = [];

	for (let i = 0; i < paragraphs.length; i++) {
		const paragraph = paragraphs[i] as string;
		const isFirstParagraph = i === 0 && result.length === 0;
		const maxWidth = isFirstParagraph ? widthFirstLine : widthAdditionalLines;

		if (stringWidth(paragraph) <= maxWidth) {
			result.push(paragraph);
		} else {
			// Need to wrap this paragraph
			const words = paragraph.split(" ");
			let currentLine = "";

			for (const word of words) {
				const testLine = currentLine ? `${currentLine} ${word}` : word;
				const currentMaxWidth =
					result.length === 0 && isFirstParagraph ? widthFirstLine : widthAdditionalLines;

				if (stringWidth(testLine) <= currentMaxWidth) {
					currentLine = testLine;
				} else {
					// Current line is full, start a new one
					if (currentLine) {
						result.push(currentLine);
					}
					currentLine = word;
				}
			}

			// Add the last line if there's content
			if (currentLine) {
				result.push(currentLine);
			}
		}
	}

	return result.length > 0 ? result : [""];
}

function formatLogObj(level: LogLevel, payload: Omit<LogEventPayload, "message">) {
	const date = chalk.gray(formatDate(payload.timestamp));
	const module = payload.module ? `${chalk.gray(payload.module)} ` : "";

	const isBadge = level === "error" || level === "warn";

	const left = formatLevelPrefix(level, isBadge);
	const right = `${module}${date}`;

	const availableSpace = process.stdout.columns - stringWidth(left) - stringWidth(right) - 2; // 2 for spaces

	const [message, ...additionalLines] = splitLines(
		formatArgs(payload.args),
		availableSpace,
		process.stdout.columns - 4,
	);

	// justify right side all the way to the right
	const spaceRight = availableSpace - stringWidth(message as string) + 1;

	let formatted = `${left.length ? `${left} ` : ""}${message}${" ".repeat(spaceRight)}${right}`;
	for (const line of additionalLines) {
		formatted += `\n   ${line}`;
	}

	// Add extra padding for badge style
	return isBadge ? `\n${formatted}\n` : formatted;
}

function formatArgs(args: unknown[]) {
	const _args = args.map((arg) => {
		if (arg instanceof Error) {
			return formatErr(arg);
		}
		return arg;
	});

	return formatWithOptions({ colors: false, compact: true }, ..._args);
}

const LOG_LEVEL_TO_NUM: { [k in LogLevel]: number } = {
	error: 0,
	warn: 1,
	info: 2,
	verbose: 3,
	debug: 4,
};

let configuredLogLevel = LOG_LEVEL_TO_NUM.info;

function setLevel(level: LogLevel) {
	configuredLogLevel = LOG_LEVEL_TO_NUM[level];
}

let lastFixedMessage: null | string = null;

function logFixedMessage(message: string | null) {
	if (lastFixedMessage === null) {
		// hide cursor when displaying fixed message
		process.stdout.write(ansiEscapes.cursorHide);
	}

	if (message === null) {
		process.stdout.write(ansiEscapes.cursorShow);
	} else {
		const lastLineCount = lastFixedMessage?.split("\n").length || 0;
		process.stdout.write(ansiEscapes.eraseLines(lastLineCount) + message); // erase last message and show new one
	}

	lastFixedMessage = message;
}

process.on("beforeExit", () => {
	if (lastFixedMessage !== null) {
		// ensure cursor is shown again
		process.stdout.write(ansiEscapes.cursorShow);
	}
});

function logFromPayload(payload: Omit<LogEventPayload, "message">) {
	if (LOG_LEVEL_TO_NUM[payload.level] > configuredLogLevel) {
		return;
	}

	const formatted = formatLogObj(payload.level, payload);

	// Forward log to parent process if detached
	forwardLog(payload.level, payload);

	if (lastFixedMessage !== null) {
		// erase fixed message before logging
		const lastLineCount = lastFixedMessage.split("\n").length;
		process.stdout.write(ansiEscapes.eraseLines(lastLineCount));
	}

	const formattedWithFixed = lastFixedMessage
		? `${formatted}\n${lastFixedMessage}`
		: `${formatted}\n`;

	if (payload.level === "error" || payload.level === "warn") {
		process.stderr.write(formattedWithFixed);
	} else {
		process.stdout.write(formattedWithFixed);
	}
}

/**
 * for a console-like API
 */
function log(level: LogLevel, ...args: unknown[]) {
	logFromPayload({
		args,
		timestamp: new Date(),
		level: level,
	});
}

export const cliLogger = {
	debug: log.bind(null, "debug"),
	info: log.bind(null, "info"),
	warn: log.bind(null, "warn"),
	error: log.bind(null, "error"),
	verbose: log.bind(null, "verbose"),
	fromPayload: logFromPayload,
	setLevel,
	fixed: logFixedMessage,
};
