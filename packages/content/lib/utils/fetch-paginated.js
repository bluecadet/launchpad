import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow';
import { SourceFetchError } from '../sources/source.js';

/**
 * @template {unknown} T
 * @typedef FetchPaginatedOptions
 * @property {number} limit The number of items to fetch per page
 * @property {number} [maxFetchCount] The maximum number of pages to fetch. If this is reached, the fetch will be terminated early.
 * @property {(params: {limit: number, offset: number}) => ResultAsync<T | null, SourceFetchError>} fetchPageFn A function that takes a params object and returns a ResultAsync of an array of T. To indicate the end of pagination, return an empty array, or null.
 * @property {import('@bluecadet/launchpad-utils').Logger} logger A logger instance
 */

/**
 * @template {unknown} T
 * @template {unknown} M
 * @typedef {ResultAsync<M extends undefined ? {pages: Array<T>} : {pages: Array<T>, meta: M}, SourceFetchError>} FetchPaginatedResult
 */

/**
 * Handles paginated fetching
 * @template {unknown} T
 * @template {unknown} [M=undefined]
 * @param {M extends undefined ? FetchPaginatedOptions<T> : FetchPaginatedOptions<T> & {meta: M}} options
 * @returns {FetchPaginatedResult<T, M>}
 */
export function fetchPaginated({ fetchPageFn, limit, logger, maxFetchCount = 1000, ...rest }) {
	/** @type {Array<T>} */
	const pages = [];
	let page = 0;

	/**
	 * @returns {ResultAsync<T | null, SourceFetchError>}
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

					if (page >= maxFetchCount) {
						return errAsync(new SourceFetchError('Maximum fetch count reached. This is likely a bug. Make sure your fetchPageFn ret'));
					}

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
