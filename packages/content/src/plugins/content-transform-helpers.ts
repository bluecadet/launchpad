import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import { FixedTTYLogger } from "@bluecadet/launchpad-utils/fixed-tty-logger";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import chalk from "chalk";
import { ResultAsync } from "neverthrow";
import type { z } from "zod";
import { DataStoreError, type Document } from "../utils/data-store.js";

export class ContentTransformError extends Error {
	constructor(pluginName: string, message: string, cause?: Error) {
		const newMessage = `Error in content plugin "${pluginName}": ${message}`;
		super(newMessage, { cause });
		this.name = "ContentTransformError";
	}
}

export function parseTransformConfig<T extends z.ZodTypeAny>(
	pluginName: string,
	schema: T,
	input: unknown,
): z.output<T> {
	try {
		return schema.parse(input);
	} catch (err) {
		throw new ContentTransformError(pluginName, "unable to parse config", err as Error);
	}
}

export function queryOrUpdate<T>({
	documents,
	callback,
	queryJsonPath,
	update = false,
}: {
	documents: Iterable<Document>;
	queryJsonPath: string;
	callback: (value: unknown) => T | Promise<T>;
	update: boolean;
}): ResultAsync<T[], DataStoreError | ContentTransformError> {
	const documentArray = Array.from(documents);

	if (update) {
		return ResultAsync.combine(
			documentArray.map((doc) => {
				const itemResults: T[] = [];
				return doc
					.apply(queryJsonPath, async (value: unknown) => {
						const result = await callback(value);
						itemResults.push(result);
						return result;
					})
					.map(() => itemResults);
			}),
		).map((nestedResults) => nestedResults.flat());
	}

	return ResultAsync.combine(
		documentArray.map((doc) =>
			doc
				.query(queryJsonPath)
				.andThen((values) =>
					ResultAsync.combine(
						values.map((value) =>
							ResultAsync.fromPromise(
								Promise.resolve(callback(value)),
								(e) => new DataStoreError("Error in queryOrUpdate callback", { cause: e as Error }),
							),
						),
					),
				),
		),
	).map((nestedResults) => nestedResults.flat());
}

export class CacheProgressLogger extends FixedTTYLogger {
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

	constructor(
		private logger: Logger,
		eventBus: EventBus,
		total: number,
	) {
		super(eventBus);
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
