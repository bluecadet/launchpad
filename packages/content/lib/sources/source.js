/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Awaitable<import('neverthrow').Result<Map<string, unknown> | undefined, string>>} FetchResult
 */

/**
 * @typedef {object} FetchContext
 * @prop {import('@bluecadet/launchpad-utils').Logger} logger
 * @prop {import('../utils/data-store.js').DataStore} data
 */

/**
 * @typedef {object} ContentSource
 * @prop {string} id
 * @prop {(ctx: FetchContext) => FetchResult} fetch
 */


/**
 * @template T
 * @typedef {(options: T) => import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Awaitable<import('neverthrow').Result<ContentSource, string>>} ContentSourceBuilder
 */


/**
 * This function doesn't do anything, just returns the source parameter. It's just to make it easier to define/type sources.
 * @param {ContentSource} src 
 * @returns {ContentSource}
 */
export function defineSource(src) {
  return src;
}