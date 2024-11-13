import type { Logger } from "@bluecadet/launchpad-utils";
import type { DataStore } from "../utils/data-store.js";
import { z } from "zod";

/**
 * Context object passed to the `fetch` method of a source.
 */
export type FetchContext = {
	/**
	 * Logger instance
	 */
	logger: Logger;
	/**
	 * Data store instance
	 */
	dataStore: DataStore;
};

function asyncIterableSchema<T = unknown>(): z.ZodType<AsyncIterable<T>> {
	return z.custom<AsyncIterable<T>>(
		(data) => {
			if (typeof data[Symbol.asyncIterator] === "function") {
				return true;
			}
			return false;
		},
		{
			message: "Expected an AsyncIterable",
		},
	);
}

const sourceFetchResultDocumentSchema = z.object({
	/** Id of the document, which is how it will be referenced in the data store */
	id: z
		.string()
		.describe("Id of the document, which is how it will be referenced in the data store"),
	/** Either a promise returning a single document, or an async iterable returning multiple documents. */
	data: z
		.union([z.promise(z.unknown()), asyncIterableSchema()])
		.describe(
			"Either a promise returning a single document, or an async iterable returning multiple documents.",
		),
});

export const contentSourceSchema = z.object({
	/** Id of the source. This will be the 'namespace' for the documents fetched from this source. */
	id: z
		.string()
		.describe(
			"Id of the source. This will be the 'namespace' for the documents fetched from this source.",
		),
	/** Fetches the documents from the source. Returns either an array of documents or a single document. */
	fetch: z
		.function(z.tuple([z.custom<FetchContext>().describe("Fetch context object.")]))
		.returns(z.union([z.array(sourceFetchResultDocumentSchema), sourceFetchResultDocumentSchema]))
		.describe(
			"Fetches the documents from the source. Returns either an array of documents or a single document.",
		),
});

export type ContentSource = z.infer<typeof contentSourceSchema>;

/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 */
export function defineSource<T extends ContentSource>(
	src: T,
): T {
	return src;
}
