import { type ResultAsync, errAsync, okAsync } from "neverthrow";
import { SourceFetchError } from "../sources/source.js";
import type { Logger } from "@bluecadet/launchpad-utils";

export type FetchPaginatedOptions<T> = {
	/**
	 * The number of items to fetch per page
	 */
	limit: number;
	/**
	 * The maximum number of pages to fetch. If this is reached, the fetch will be terminated early.
	 */
	maxFetchCount?: number;
	/**
	 * A function that takes a params object and returns a ResultAsync of an array of T. To indicate the end of pagination, return an empty array, or null.
	 */
	fetchPageFn: (params: { limit: number; offset: number }) => ResultAsync<T | null, SourceFetchError>;
	/**
	 * A logger instance
	 */
	logger: Logger;
};

export type FetchPaginatedResult<T, M> = ResultAsync<M extends undefined ? { pages: Array<T> } : { pages: Array<T>; meta: M }, SourceFetchError>;

/**
 * Handles paginated fetching
 * @template {unknown} T
 * @template {unknown} [M=undefined]
 * @param {M extends undefined ? FetchPaginatedOptions<T> : FetchPaginatedOptions<T> & {meta: M}} options
 * @returns {FetchPaginatedResult<T, M>}
 */
export function fetchPaginated<T, M = undefined>({
	fetchPageFn,
	limit,
	logger,
	maxFetchCount = 1000,
	...rest
}: FetchPaginatedOptions<T> & { meta?: M }): FetchPaginatedResult<T, M> {
	const pages: Array<T> = [];
	let page = 0;

	const fetchNextPage: () => ResultAsync<T | null, SourceFetchError> = () => {
		logger.debug(`Fetching page ${page}`);
		return fetchPageFn({ limit, offset: page * limit }).andThen((data) => {
			if (data === null || (Array.isArray(data) && data.length === 0)) {
				return okAsync(null);
			}
			pages.push(data);
			page++;

			if (page >= maxFetchCount) {
				return errAsync(new SourceFetchError("Maximum fetch count reached. This is likely a bug. Make sure your fetchPageFn ret"));
			}

			return fetchNextPage();
		});
	};

	return fetchNextPage().andThen(() => {
		if ("meta" in rest) {
			// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
			return okAsync({ pages, meta: rest.meta }) as FetchPaginatedResult<T, M>;
		}
		// Have to cast to FetchPaginatedResult<T, M> because TS gets confused by the 'M extends undefined ?'... stuff
		return okAsync({ pages }) as FetchPaginatedResult<T, M>;
	});
}
