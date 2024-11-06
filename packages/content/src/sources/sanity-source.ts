import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import { defineSource, SourceConfigError, SourceFetchError, SourceMissingDependencyError, type SourceFetchPromise } from "./source.js";
import { fetchPaginated } from "../utils/fetch-paginated.js";

type BaseSanityOptions = {
	/**
	 * Required field to identify this source. Will be used as download path.
	 */
	id: string;
	/**
	 * API Version. Defaults to 'v2021-10-21'
	 */
	apiVersion?: string;
	/**
	 * Sanity Project ID
	 */
	projectId: string;
	/**
	 * API Token defined in your sanity project.
	 */
	apiToken: string;
	/**
	 * Dataset. Defaults to 'production'
	 */
	dataset?: string;
	/**
	 * `false` if you want to ensure fresh data
	 */
	useCdn?: boolean;
	/**
	 * An array of queries to fetch. Each query can be a string or an object with a query and an id.
	 */
	queries: Array<string | { query: string; id: string }>;
	/**
	 * Max number of entries per page. Defaults to 100.
	 */
	limit?: number;
	/**
	 * Max number of pages. Use `-1` for all pages. Defaults to -1.
	 */
	maxNumPages?: number;
	/**
	 * To combine paginated files into a single file. Defaults to false.
	 */
	mergePages?: boolean;
	/**
	 * How many zeros to pad each json filename index with. Defaults to 0.
	 */
	pageNumZeroPad?: number;
};

const SANITY_OPTION_DEFAULTS = {
	apiVersion: "v2021-10-21",
	dataset: "production",
	useCdn: false,
	limit: 100,
	maxNumPages: -1,
	mergePages: true,
	pageNumZeroPad: 0,
} satisfies Partial<BaseSanityOptions>;

export default function sanitySource(options: BaseSanityOptions) {
	if (!options.projectId || !options.apiToken) {
		return errAsync(new SourceConfigError("Missing projectId and/or apiToken"));
	}

	const assembledOptions = {
		...SANITY_OPTION_DEFAULTS,
		...options,
	};

	return ResultAsync.fromPromise(
		import("@sanity/client"),
		() => new SourceMissingDependencyError('Could not find "@sanity/client". Make sure you have installed it.'),
	).map(({ createClient }) => {
		const sanityClient = createClient({
			projectId: assembledOptions.projectId,
			dataset: assembledOptions.dataset,
			apiVersion: assembledOptions.apiVersion, // use current UTC date - see "specifying API version"!
			token: assembledOptions.apiToken, // or leave blank for unauthenticated usage
			useCdn: assembledOptions.useCdn, // `false` if you want to ensure fresh data);
		});

		return defineSource({
			id: options.id,
			fetch: (ctx) => {
				function combinePages(pages: Array<unknown>, id: string) {
					if (assembledOptions.mergePages) {
						const combinedResult = pages.flat(1);

						return [
							{
								id,
								data: combinedResult,
							},
						];
					}
					return pages.map((page, i) => {
						const pageNum = i + 1;
						const keyWithPageNum = `${id}-${pageNum.toString().padStart(assembledOptions.pageNumZeroPad, "0")}`;

						return {
							id: keyWithPageNum,
							data: page,
						};
					});
				}

				const documentFetchPromises: Array<SourceFetchPromise> = [];

				for (const query of assembledOptions.queries) {
					if (typeof query === "string") {
						const queryFull = `*[_type == "${query}" ]`;

						documentFetchPromises.push({
							id: query,
							dataPromise: fetchPaginated({
								fetchPageFn: (params) => {
									const q = `${queryFull}[${params.offset}..${params.offset + params.limit - 1}]`;
									return ResultAsync.fromPromise(sanityClient.fetch(q), (e) => new SourceFetchError(`Could not fetch page with query: '${q}'`, { cause: e }));
								},
								limit: assembledOptions.limit,
								logger: ctx.logger,
							}).map((data) => combinePages(data.pages, query)),
						});
					} else if (typeof query === "object" && query.query && query.id) {
						documentFetchPromises.push({
							id: query.id,
							dataPromise: fetchPaginated({
								fetchPageFn: (params) => {
									const q = `${query.query}[${params.offset}..${params.offset + params.limit - 1}]`;
									return ResultAsync.fromPromise(sanityClient.fetch(q), (e) => new SourceFetchError(`Could not fetch page with query: '${q}'`, { cause: e }));
								},
								limit: assembledOptions.limit,
								logger: ctx.logger,
							}).map((data) => combinePages(data.pages, query.id)),
						});
					} else {
						ctx.logger.error(`Invalid query: ${query}`);
						return err(new SourceFetchError(`Invalid query: ${query}`));
					}
				}

				return ok(documentFetchPromises);
			},
		});
	});
}
