import winston from "winston";
import ansiEscapes from "ansi-escapes";
import type { ConsoleTransportOptions } from "winston/lib/winston/transports/index.js";
import { onExit } from "./on-exit.js";
import type { TransformableInfo, Format } from "logform";
import type { Logger } from "./log-manager.js";

export const TTY_ONLY = Symbol("ttyOnly");
export const NO_TTY = Symbol("noTTY");
export const TTY_FIXED = Symbol("ttyFixed");
export const TTY_FIXED_END = Symbol("ttyFixedEnd");

/**
 * Custom winston transport that allows for fixed messages to be displayed on the console.
 * The fixed message will be displayed at the bottom of the console and will not be removed by other log messages.
 * This is useful for progress bars, status messages, etc.
 */
export class CustomConsoleTransport extends winston.transports.Console {
	constructor(args: ConsoleTransportOptions) {
		super(args);

		onExit(this.#handleQuit);
	}

	#fixedMessage: string | null = null;

	override log(info: { message: string } & Record<string | symbol, unknown>, callback: () => void) {
		if (info[TTY_FIXED] === true) {
			this.#updateFixedMessage(info.message);
			callback();
			return;
		}

		if (info[TTY_FIXED_END] === true) {
			this.#updateFixedMessage(null);
			callback();
			return;
		}

		if (this.#fixedMessage !== null) {
			const lines = this.#fixedMessage.split("\n").length;
			process.stdout.write(ansiEscapes.eraseLines(lines));
		}
		if (super.log) {
			super.log(info, () => {
				// after normal log, log the fixed message again
				if (this.#fixedMessage !== null) {
					process.stdout.write(ansiEscapes.eraseDown);
					process.stdout.write(this.#fixedMessage);
				}

				callback();
			});
		}
	}
	#updateFixedMessage(message: string | null) {
		const lastMessage = this.#fixedMessage;
		if (lastMessage === null) {
			// hide cursor when displaying fixed message
			process.stdout.write(ansiEscapes.cursorHide);
		}

		if (message === null) {
			process.stdout.write(ansiEscapes.cursorShow);
		} else {
			const lastLineCount = lastMessage?.split("\n").length || 0;
			process.stdout.write(ansiEscapes.eraseLines(lastLineCount)); // erase last message
			process.stdout.write(message);
		}

		this.#fixedMessage = message;
	}

	#handleQuit() {
		// make sure to show cursor before exiting
		process.stdout.write(ansiEscapes.cursorShow);
	}
}

export class FilterLogType implements Format {
	constructor(private readonly type: "file" | "tty") {}

	transform(info: TransformableInfo) {
		const isTTyLog = !!info[TTY_ONLY] || !!info[TTY_FIXED] || !!info[TTY_FIXED_END];
		const isNoTTYLog = !!info[NO_TTY];

		// remove ttyFixed and ttyFixedEnd from file logs
		if (this.type === "file" && isTTyLog) {
			return false;
		}

		if (this.type === "tty" && isNoTTYLog) {
			return false;
		}

		// remove tty props, as these don't need to be logged in files or tty
		info[TTY_ONLY] = undefined;
		info[NO_TTY] = undefined;

		return info;
	}
}

export abstract class FixedConsoleLogger {
	#interval: NodeJS.Timeout;

	constructor(
		protected logger: Logger,
		level = "info",
		ttyUpdateInterval = 50,
	) {
		this.#interval = setInterval(() => {
			this.update();
		}, ttyUpdateInterval);
	}

	abstract getFixedConsoleMessage(): string;

	update() {
		this.logger.log({
			level: "info",
			message: this.getFixedConsoleMessage(),
			[TTY_FIXED]: true,
		});
	}

	close() {
		clearInterval(this.#interval);
		this.update();
		this.logger.info("", { [TTY_FIXED_END]: true });
	}
}
