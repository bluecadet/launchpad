import type { EventBus } from "./event-bus.js";

/**
 * Abstract class for managing fixed console log messages.
 * Subclasses must implement getFixedConsoleMessage() to provide the message content.
 * The class handles periodic updates and cleanup on close.
 *
 * Emits "log:tty" and "log:tty:close" events on the provided EventBus.
 */
export abstract class FixedTTYLogger {
	#interval: NodeJS.Timeout | null = null;
	#didClose = false;

	constructor(
		private eventBus: EventBus,
		/**
		 * Interval in milliseconds to update the fixed console message.
		 * Set to -1 to disable automatic updates. You can call update() manually instead.
		 */
		ttyUpdateInterval = 50,
	) {
		if (ttyUpdateInterval >= 0) {
			this.#interval = setInterval(() => {
				this.update();
			}, ttyUpdateInterval);
		}
	}

	abstract getFixedConsoleMessage(): string;

	update() {
		this.eventBus.emit("log:tty", {
			message: this.getFixedConsoleMessage(),
		});
	}

	close() {
		if (this.#didClose) {
			return;
		}

		this.#didClose = true;

		if (this.#interval !== null) {
			clearInterval(this.#interval);
		}
		this.update();
		this.eventBus.emit("log:tty:close", {});
	}
}
