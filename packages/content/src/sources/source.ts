import type { Logger } from "@bluecadet/launchpad-utils";
import type { Result, ResultAsync } from "neverthrow";
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
	 * serializable data fetched from the source
	 */
	data: T;
};

/**
 * Represents a single fetch promise from a source, which can return multiple documents.
 */
export type SourceFetchPromise<T = unknown> = {
	/**
	 * Id of the fetch request, used for logging and debugging
	 */
	id: string;
	/**
	 * Promise that resolves to an array of documents
	 */
	dataPromise: ResultAsync<Array<SourceFetchResultDocument<T>>, SourceFetchError | SourceParseError>;
};

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
export type ContentSource<T = unknown> = {
	/**
	 * Id of the source. This will be the 'namespace' for the documents fetched from this source.
	 */
	id: string;
	fetch: (ctx: FetchContext) => Result<Array<SourceFetchPromise<T>>, SourceFetchError | SourceParseError>;
};

/**
 * Represents a function that builds a content source.
 */
export type ContentSourceBuilder<O, T = unknown> = (options: O) => ResultAsync<ContentSource<T>, SourceConfigError | SourceMissingDependencyError>;

/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 */
export function defineSource<T = unknown>(src: ContentSource<T>) {
	return src;
}

export class SourceFetchError extends Error {
	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.name = "SourceFetchError";
	}
}

export class SourceConfigError extends Error {
	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.name = "SourceConfigError";
	}
}

export class SourceParseError extends Error {
	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.name = "SourceParseError";
	}
}

export class SourceMissingDependencyError extends Error {
	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.name = "SourceMissingDependencyError";
	}
}
