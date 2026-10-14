import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import { FixedTTYLogger } from "@bluecadet/launchpad-utils/fixed-tty-logger";
import chalk from "chalk";

export type ContentProgressLoggerOptions = {
	eventBus: EventBus;
	/** Fixed number of tasks. Must be a nonnegative safe integer. */
	total: number;
	/** Nonempty, single-line activity label without a trailing colon. */
	label: string;
	/** Label for freshly completed work. Defaults to "Processed". */
	freshLabel?: string;
};

/** Supplies the renderer required by FixedTTYLogger without exposing inheritance to callers. */
class ProgressTTYLogger extends FixedTTYLogger {
	constructor(
		eventBus: EventBus,
		private readonly render: () => string,
	) {
		super(eventBus);
	}

	override getFixedConsoleMessage(): string {
		return this.render();
	}
}

function validateLabel(label: string, name: string): void {
	if (typeof label !== "string" || label.trim().length === 0 || /[\r\n\u2028\u2029]/u.test(label)) {
		throw new TypeError(`${name} must be a nonempty, single-line string`);
	}
}

/**
 * Reports successful task completions with or without cache reuse.
 * Await each task before calling complete(), and close in finally after all active work settles.
 * Emits log:tty events even without a TTY; it does not own task execution or cache lifecycle.
 */
export class ContentProgressLogger {
	readonly #total: number;
	readonly #label: string;
	readonly #freshLabel: string;
	readonly #ttyLogger: ProgressTTYLogger;
	#fresh = 0;
	#cached = 0;
	#closed = false;

	constructor({ eventBus, total, label, freshLabel = "Processed" }: ContentProgressLoggerOptions) {
		if (!Number.isSafeInteger(total) || total < 0) {
			throw new RangeError("total must be a nonnegative safe integer");
		}
		validateLabel(label, "label");
		validateLabel(freshLabel, "freshLabel");
		this.#total = total;
		this.#label = label;
		this.#freshLabel = freshLabel;
		this.#ttyLogger = new ProgressTTYLogger(eventBus, () => this.#render());
	}

	get total(): number {
		return this.#total;
	}

	get fresh(): number {
		return this.#fresh;
	}

	get cached(): number {
		return this.#cached;
	}

	/** Omitted result or reused: false counts as fresh; reused: true counts as cached. */
	complete(result?: { reused: boolean }): void {
		if (this.#closed) return;
		if (result !== undefined && (result === null || typeof result.reused !== "boolean")) {
			throw new TypeError("completion result must have a boolean reused property");
		}
		if (this.#fresh + this.#cached >= this.#total) {
			throw new RangeError("completed tasks cannot exceed total");
		}
		if (result?.reused) this.#cached++;
		else this.#fresh++;
		this.#ttyLogger.update();
	}

	/** Flushes the current state and stops updates once. Later completions are inert. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#ttyLogger.close();
	}

	#render(): string {
		const prefix = `${this.#label}: `;
		return (
			`${prefix}${this.#renderBar(prefix.length)}\n` +
			`${this.#freshLabel}: ${chalk.green(this.#fresh)}, Cached: ${chalk.yellow(this.#cached)}, Remaining: ${this.#total - this.#fresh - this.#cached} \n`
		);
	}

	#renderBar(prefixLength: number): string {
		if (this.#total === 0) return "";
		const columns = process.stdout.columns;
		const barLength =
			columns === undefined ? 60 : Math.max(0, Math.min(60, Math.floor(columns - prefixLength)));
		const freshLength = Math.round((this.#fresh / this.#total) * barLength);
		const cachedLength = Math.min(
			barLength - freshLength,
			Math.round((this.#cached / this.#total) * barLength),
		);
		const remainingLength = barLength - freshLength - cachedLength;
		return (
			chalk.green("=".repeat(freshLength)) +
			chalk.yellow("=".repeat(cachedLength)) +
			chalk.gray("=".repeat(remainingLength))
		);
	}
}
