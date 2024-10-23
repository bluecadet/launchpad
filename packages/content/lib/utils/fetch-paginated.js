import { ResultAsync, err, ok, okAsync } from 'neverthrow';

/**
 * @template {unknown} T
 * @typedef FetchPaginatedOptions
 * @property {number} limit The number of items to fetch per page
 * @property {(params: {limit: number, offset: number}) => ResultAsync<T | null, import('../sources/source-errors.js').SourceError>} fetchPageFn A function that takes a params object and returns a ResultAsync of an array of T. To indicate the end of pagination, return an empty array, or null.
 * @property {import('@bluecadet/launchpad-utils').Logger} logger A logger instance
 */

/**
 * @template {unknown} T
 * @template {unknown} M
 * @typedef {ResultAsync<M extends undefined ? {pages: Array<T>} : {pages: Array<T>, meta: M}, import('../sources/source-errors.js').SourceError>} FetchPaginatedResult
 */

/**
 * Handles paginated fetching
 * @template {unknown} T
 * @template {unknown} [M=undefined]
 * @param {M extends undefined ? FetchPaginatedOptions<T> : FetchPaginatedOptions<T> & {meta: M}} options
 * @returns {FetchPaginatedResult<T, M>}
 */
export function fetchPaginated({ fetchPageFn, limit, logger, ...rest }) {
	/** @type {Array<T>} */
	const pages = [];
	let page = 0;

	/**
	 * @returns {ResultAsync<T | null, import('../sources/source-errors.js').SourceError>}
	 */
	const fetchNextPage = () => {
		logger.debug(`Fetching page ${page}`);
		return fetchPageFn({ limit, offset: page * limit })
			.andThen((data) => {
				if (data === null || (Array.isArray(data) && data.length === 0)) {
					return okAsync(null);
				} else {
					pages.push(data);
					page++;
					return fetchNextPage();
				}
			});
	};

	return fetchNextPage()
		.andThen(() => {
			if ('meta' in rest) {
				// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
				return /** @type {FetchPaginatedResult<T, M>} */ (okAsync({ pages, meta: rest.meta }));
			}
			// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
			return /** @type {FetchPaginatedResult<T, M>} */ (okAsync({ pages }));
		});
}
