import { FixedConsoleLogger, type Logger } from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import type { z } from "zod";
import type { Document } from "../utils/data-store.js";

export class ContentPluginError extends Error {
	constructor(pluginName: string, message: string, cause?: Error) {
		const newMessage = `Error in content plugin "${pluginName}": ${message}`;
		super(newMessage, { cause });
		this.name = "ContentPluginError";
	}
}

export function parsePluginConfig<T extends z.ZodTypeAny>(
	pluginName: string,
	schema: T,
	input: unknown,
): z.output<T> {
	try {
		return schema.parse(input);
	} catch (err) {
		throw new ContentPluginError(pluginName, "unable to parse config", err as Error);
	}
}

export async function queryOrUpdate<T>({
	documents,
	callback,
	queryJsonPath,
	update = false,
}: {
	documents: Iterable<Document>;
	queryJsonPath: string;
	callback: (value: unknown) => T | Promise<T>;
	update: boolean;
}): Promise<T[]> {
	const results: T[] = [];

	for (const document of documents) {
		if (update) {
			await document.apply(queryJsonPath, async (value: unknown) => {
				const result = await callback(value);
				results.push(result);
				return result;
			});
		} else {
			const values = await document.query(queryJsonPath);
			for (const value of values) {
				const result = await callback(value);
				results.push(result);
			}
		}
	}

	return Promise.all(results);
}

export class CacheProgressLogger extends FixedConsoleLogger {
	#total: number;
	#fresh = 0;
	#cached = 0;

	get fresh() {
		return this.#fresh;
	}

	get cached() {
		return this.#cached;
	}

	get total() {
		return this.#total;
	}

	constructor(logger: Logger, total: number) {
		super(logger, 0);
		this.#total = total;
	}

	addFresh() {
		this.#fresh++;
		this.update();
	}

	addCached() {
		this.#cached++;
		this.update();
	}

	protected renderProgressBar(additionalCharCount = 0): string {
		const total = this.#total;
		const fresh = this.#fresh;
		const cached = this.#cached;
		const BAR_LENGTH = Math.min(
			60,
			process.stdout.columns ? Math.floor(process.stdout.columns - additionalCharCount) : 60,
		);

		// Calculate exact segments
		const freshLength = Math.round((fresh / total) * BAR_LENGTH);
		const cachedLength = Math.round((cached / total) * BAR_LENGTH);
		// Ensure remaining is never negative
		const remainingLength = Math.max(0, BAR_LENGTH - freshLength - cachedLength);

		const fetchedBar = chalk.green("=".repeat(freshLength));
		const cachedBar = chalk.yellow("=".repeat(cachedLength));
		const remainingBar = chalk.gray("=".repeat(remainingLength));

		return `${fetchedBar}${cachedBar}${remainingBar}`;
	}

	override getFixedConsoleMessage(): string {
		return `${this.renderProgressBar()}`;
	}
}
