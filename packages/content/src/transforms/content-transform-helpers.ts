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

export function parseTransformConfig<T extends z.ZodType>(
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
