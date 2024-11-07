import type { Logger } from "@bluecadet/launchpad-utils";

export type FetchPaginatedOptions<T, Merge extends boolean> = {
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
	fetchPageFn: (params: { limit: number; offset: number }) => Promise<T | null>;
	/**
	 * A logger instance
	 */
	logger: Logger;
	/**
	 * Whether to merge pages into a single array. Defaults to false.
	 */
	mergePages?: Merge;
};

/**
 * Handles paginated fetching. Returns an async iterable, unless mergePages is true in which case it returns a flattened array.
 */
export function fetchPaginated<T, Merge extends boolean = false>({
	fetchPageFn,
	limit,
	logger,
	maxFetchCount = 1000,
	mergePages,
}: FetchPaginatedOptions<T, Merge>): Merge extends true ? Promise<T[]> : AsyncGenerator<T> {
	async function* generator() {
		for (let i = 0; i < maxFetchCount; i++) {
			logger.debug(`Fetching page ${i}`);
			const data = await fetchPageFn({ limit, offset: i * limit });

			if (data === null || (Array.isArray(data) && data.length === 0)) {
				return;
			}

			yield data as T;
		}
	}

	return (mergePages ? getFlattened(generator()) : generator()) as Merge extends true
		? Promise<T[]>
		: AsyncGenerator<T>;
}

async function getFlattened<T>(generator: AsyncGenerator<T>) {
	const pages: T[] = [];
	for await (const page of generator) {
		pages.push(page);
	}
	return pages.flat(1);
}
