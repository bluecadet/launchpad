/**
 * Represents a single document fetched from a source.
 * @typedef {object} SourceFetchResultDocument
 * @prop {string} id Id of the document, which is how it will be referenced in the data store
 * @prop {unknown} data serializable data fetched from the source
 */

/**
 * Represents a single fetch promise from a source, which can return multiple documents.
 * @typedef {object} SourceFetchPromise
 * @prop {string} id Id of the fetch request, used for logging and debugging
 * @prop {import('neverthrow').ResultAsync<Array<SourceFetchResultDocument>, import('./source-errors.js').SourceError>} dataPromise Promise that resolves to an array of documents
 */

/**
 * @typedef {object} FetchContext
 * @prop {import('@bluecadet/launchpad-utils').Logger} logger
 * @prop {import('../utils/data-store.js').DataStore} dataStore
 */

/**
 * @typedef {object} ContentSource
 * @prop {string} id Id of the source. This will be the 'namespace' for the documents fetched from this source.
 * @prop {(ctx: FetchContext) => import('neverthrow').Result<Array<SourceFetchPromise>, import('./source-errors.js').SourceError>} fetch
 */

/**
 * @template T
 * @typedef {(options: T) => import('neverthrow').ResultAsync<ContentSource, import('./source-errors.js').SourceError>} ContentSourceBuilder
 */

/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 * @param {ContentSource} src 
 * @returns {ContentSource}
 */
export function defineSource(src) {
	return src;
}
