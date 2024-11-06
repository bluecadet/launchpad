import type { Logger } from "@bluecadet/launchpad-utils";
import type { DataStore } from "../utils/data-store.js";

/**
 * Represents a single document fetched from a source.
 */
export type SourceFetchResultDocument<T = unknown> = {
	/**
	 * Id of the document, which is how it will be referenced in the data store
	 */
	id: string;
	/**
	 * Either a promise returning a single document, or an async iterable returning multiple documents.
	 */
	data: Promise<T> | AsyncIterable<T>;
};

export type FetchResult<T> = SourceFetchResultDocument<T>[] | SourceFetchResultDocument<T>;

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

/**
 * Represents a single content source.
 */
export type ContentSource<T = unknown, F extends FetchResult<T> = FetchResult<T>> = {
	/**
	 * Id of the source. This will be the 'namespace' for the documents fetched from this source.
	 */
	id: string;
	/**
	 * Fetches the documents from the source. Returns either an array of documents or a single document.
	 */
	fetch: (ctx: FetchContext) => F;
};

/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 */
export function defineSource<T = unknown, F extends FetchResult<T> = FetchResult<T>>(src: ContentSource<T, F>) {
	return src;
}
