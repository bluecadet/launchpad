import { err, ok } from 'neverthrow';

/**
 * @template {unknown} T
 * @typedef FetchPaginatedOptions
 * @property {number} limit The number of items to fetch per page
 * @property {(params: {limit: number, offset: number}) => Promise<import('neverthrow').Result<T | null, import('../sources/source-errors.js').SourceError>>} fetchPageFn A function that takes a params object and returns a promise of an array of T. To indicate the end of pagination, return an empty array, or null.
 * @property {import('@bluecadet/launchpad-utils').Logger} logger A logger instance
 */

/**
 * @template {unknown} T
 * @template {unknown} M
 * @typedef {import('neverthrow').Result<M extends undefined ? {pages: Array<T>} : {pages: Array<T>, meta: M}, import('../sources/source-errors.js').SourceError>} FetchPaginatedResult
 */

/**
 * Handles paginated fetching
 * @template {unknown} T
 * @template {unknown} [M=undefined]
 * @param {M extends undefined ? FetchPaginatedOptions<T> : FetchPaginatedOptions<T> & {meta: M}} options
 * @returns {Promise<FetchPaginatedResult<T, M>>}
 */
export async function fetchPaginated({ fetchPageFn, limit, logger, ...rest }) {
	/** @type {Array<T>} */
	const pages = [];
	let page = 0;
	let hasMore = true;

	while (hasMore) {
		logger.debug(`Fetching page ${page}`);
		const data = await fetchPageFn({ limit, offset: page * limit });

		if (data.isErr()) {
			return err(data.error);
		}

		if (data.value === null || (Array.isArray(data.value) && data.value.length === 0)) {
			hasMore = false;
		} else {
			pages.push(data.value);
			page++;
		}
	}

	if ('meta' in rest) {
		// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
		return /** @type {FetchPaginatedResult<T, M>} */ (ok({ pages, meta: rest.meta }));
	}

	// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
	return /** @type {FetchPaginatedResult<T, M>} */ (ok({ pages }));
}
