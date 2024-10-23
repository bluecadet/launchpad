/**
 * @typedef {Map<string, unknown> | undefined} FetchResultMap
 */

/**
 * Either a Promise of a Map or a ResultAsync of a Map.
 * @typedef {Promise<FetchResultMap> | import('neverthrow').ResultAsync<FetchResultMap, import('./source-errors.js').SourceError>} FetchResult
 */

/**
 * @typedef {object} FetchContext
 * @prop {import('@bluecadet/launchpad-utils').Logger} logger
 * @prop {import('../utils/data-store.js').DataStore} dataStore
 */

/**
 * @typedef {object} ContentSource
 * @prop {string} id
 * @prop {(ctx: FetchContext) => FetchResult} fetch
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
