import { err, ok } from 'neverthrow';
import { defineSource } from './source.js';

/**
 * @typedef BaseSanityOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {string} [apiVersion] API Version. Defailts to 'v2021-10-21'
 * @property {string} projectId Sanity Project ID
 * @property {string} apiToken API Token defined in your sanity project.
 * @property {string} [dataset] Dataset. Defaults to 'production'
 * @property {boolean} [useCdn] `false` if you want to ensure fresh data
 * @property {string} baseUrl The base url of your Sanity CMS (with or without trailing slash).
 * @property {Array<string | {query: string, id: string}>} queries An array of queries to fetch. Each query can be a string or an object with a query and an id.
 * @property {number} [limit] Max number of entries per page. Defaults to 100.
 * @property {number} [maxNumPages] Max number of pages. Use `-1` for all pages. Defaults to -1.
 * @property {boolean} [mergePages] To combine paginated files into a single file. Defaults to false.
 * @property {number} [pageNumZeroPad] How many zeros to pad each json filename index with. Defaults to 0.
 */

const SANITY_OPTION_DEFAULTS = {
	apiVersion: 'v2021-10-21',
	dataset: 'production',
	useCdn: false,
	limit: 100,
	maxNumPages: -1,
	mergePages: true,
	pageNumZeroPad: 0,
	appendCroppedFilenames: true
};

/**
 * @type {import("./source.js").ContentSourceBuilder<BaseSanityOptions>}
 */
export default async function sanitySource(options) {
	if (!options.projectId || !options.apiToken) {
		return err('Missing projectId or apiToken');
	}

	const assembledOptions = {
		...SANITY_OPTION_DEFAULTS,
		...options
	};

	/**
   * @type {import('@sanity/client').SanityClient}
   */
	let sanityClient;

	// async import because it's an optional dependency
	try {
		const { createClient } = await import('@sanity/client');
		sanityClient = createClient({
			projectId: assembledOptions.projectId,
			dataset: assembledOptions.dataset,
			apiVersion: assembledOptions.apiVersion, // use current UTC date - see "specifying API version"!
			token: assembledOptions.apiToken, // or leave blank for unauthenticated usage
			useCdn: assembledOptions.useCdn // `false` if you want to ensure fresh data);
		});
	} catch (error) {
		return err('Could not find "@sanity/client". Make sure you have installed it.');
	}

	/**
   * @param {string} id
   * @param {string} query
   * @param {Array<unknown>} pageResultArray
   * @param {{start: number, limit: number}} params
   * @param {import('@bluecadet/launchpad-utils').Logger} logger
   * @returns {Promise<import('neverthrow').Result<Array<unknown>, string>>}
   */
	async function fetchSanityPagesRecursive(id, query, logger, params = { start: 0, limit: 100 }, pageResultArray = []) {
		const pageNum = params.start / params.limit || 0;

		const q = `${query}[${params.start}..${params.start + params.limit - 1}]`;

		logger.debug(`Fetching page ${pageNum} of ${id}`);

		try {
			const content = await sanityClient.fetch(q);

			if (!content || !content.length) {
				return ok(pageResultArray);
			}

			pageResultArray.push(content);

			return fetchSanityPagesRecursive(id, query, logger, { start: params.start + params.limit, limit: params.limit }, pageResultArray);
		} catch (error) {
			if (error instanceof Error) {
				logger.error(`Could not fetch page: ${error.message}`);
			} else {
				logger.error(`Could not fetch page: ${error}`);
			}
			return err(`Could not fetch page with query: '${query}'`);
		}
	}

	return ok(defineSource({
		id: options.id,
		fetch: async (ctx) => {
			/**
       * @type {Array<ReturnType<typeof fetchSanityPagesRecursive>>}
       */
			const queryPromises = [];

			const queryKeys = [];

			for (const query of assembledOptions.queries) {
				if (typeof query === 'string') {
					const queryFull = '*[_type == "' + query + '" ]';

					queryPromises.push(
						fetchSanityPagesRecursive(query, queryFull, ctx.logger, {
							start: 0,
							limit: assembledOptions.limit
						})
					);

					queryKeys.push(query);
				} else if (typeof query === 'object' && query.query && query.id) {
					queryPromises.push(
						fetchSanityPagesRecursive(query.id, query.query, ctx.logger, {
							start: 0,
							limit: assembledOptions.limit
						})
					);

					queryKeys.push(query.id);
				} else {
					ctx.logger.error(`Invalid query: ${query}`);
					return err(`Invalid query: ${query}`);
				}
			}

			const results = await Promise.all(queryPromises);

			const resultMap = new Map();

			let index = -1;
			for (const result of results) {
				index++;
				const queryKey = queryKeys[index];

				if (result.isErr()) {
					return err(result.error);
				}

				const resultArray = result.value;

				if (assembledOptions.mergePages) {
					const combinedResult = resultArray.flat(1);

					resultMap.set(queryKey, combinedResult);
				} else {
					for (let i = 0; i < resultArray.length; i++) {
						const pageNum = i + 1;
						const keyWithPageNum = `${queryKey}-${pageNum
							.toString()
							.padStart(assembledOptions.pageNumZeroPad, '0')}`;

						resultMap.set(keyWithPageNum, resultArray[i]);
					}
				}
			}

			return ok(resultMap);
		}
	}));
}
