/**
 * Represents a single document fetched from a source.
 * @template [T=unknown]
 * @typedef {object} SourceFetchResultDocument
 * @prop {string} id Id of the document, which is how it will be referenced in the data store
 * @prop {T} data serializable data fetched from the source
 */

/**
 * Represents a single fetch promise from a source, which can return multiple documents.
 * @template [T=unknown]
 * @typedef {object} SourceFetchPromise
 * @prop {string} id Id of the fetch request, used for logging and debugging
 * @prop {import('neverthrow').ResultAsync<Array<SourceFetchResultDocument<T>>, SourceFetchError | SourceParseError>} dataPromise Promise that resolves to an array of documents
 */

/**
 * @typedef {object} FetchContext
 * @prop {import('@bluecadet/launchpad-utils').Logger} logger
 * @prop {import('../utils/data-store.js').DataStore} dataStore
 */

/**
 * @template [T=unknown]
 * @typedef {object} ContentSource
 * @prop {string} id Id of the source. This will be the 'namespace' for the documents fetched from this source.
 * @prop {(ctx: FetchContext) => import('neverthrow').Result<Array<SourceFetchPromise<T>>, SourceFetchError | SourceParseError>} fetch
 */

/**
 * @template O
 * @template [T=unknown]
 * @typedef {(options: O) => import('neverthrow').ResultAsync<ContentSource<T>, SourceConfigError | SourceMissingDependencyError>} ContentSourceBuilder
 */

/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 * @template [T=unknown]
 * @param {ContentSource<T>} src 
 * @returns {ContentSource<T>}
 */
export function defineSource(src) {
	return src;
}

export class SourceFetchError extends Error {
	/**
	 * @param {string} message
	 * @param {object} [options]
	 * @param {unknown} [options.cause]
	 */
	constructor(message, { cause } = {}) {
		super(message, { cause });
		this.name = 'SourceFetchError';
	}
}

export class SourceConfigError extends Error {
	/**
	 * @param {string} message
	 * @param {object} [options]
	 * @param {unknown} [options.cause]
	 */
	constructor(message, { cause } = {}) {
		super(message, { cause });
		this.name = 'SourceConfigError';
	}
}

export class SourceParseError extends Error {
	/**
	 * @param {string} message
	 * @param {object} [options]
	 * @param {unknown} [options.cause]
	 */
	constructor(message, { cause } = {}) {
		super(message, { cause });
		this.name = 'SourceParseError';
	}
}

export class SourceMissingDependencyError extends Error {
	/**
	 * @param {string} message
	 * @param {object} [options]
	 * @param {unknown} [options.cause]
	 */
	constructor(message, { cause } = {}) {
		super(message, { cause });
		this.name = 'SourceMissingDependencyError';
	}
}
