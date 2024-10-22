import ky from 'ky';
import qs from 'qs';
import { defineSource } from './source.js';
import { err, ok, Result, ResultAsync } from 'neverthrow';
import chalk from 'chalk';
import { configError, fetchError, parseError } from './source-errors.js';
import { fetchPaginated } from '../utils/fetch-paginated.js';

/**
 * @typedef StrapiObjectQuery
 * @property {string} contentType The content type to query
 * @property {{pagination?: {page: number, pageSize: number}, [key: string]: unknown}} params Query parameters. Uses `qs` library to stringify.
 */

/**
 * @typedef StrapiPagination
 * @property {number} start The index of the first item to fetch
 * @property {number} limit The number of items to fetch
 */

/** 
 * @typedef StrapiLoginCredentials
 * @property {string} identifier Username or email. Should be configured via `./.env.local`
 * @property {string} password Should be configured via `./.env.local`
 *
 * @typedef StrapiTokenCredentials
 * @property {string} token Can be used instead of identifer/password if you previously generated one. Otherwise this will be automatically generated using the identifier or password.
 *
 * @typedef {StrapiLoginCredentials | StrapiTokenCredentials} StrapiCredentials
 */

/**
 * @typedef BaseStrapiOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {'4' | '3'} [version] Versions `3` and `4` are supported. Defaults to `3`.
 * @property {string} baseUrl The base url of your Strapi CMS (with or without trailing slash).
 * @property {Array<string | StrapiObjectQuery>} queries Queries for each type of content you want to save. One per content type. Content will be stored as numbered, paginated JSONs.
 * You can include all query parameters supported by Strapi.
 * You can also pass an object with a `contentType` and `params` property, where `params` is an object of query parameters.
 * @property {number} [limit] Max number of entries per page. Defaults to `100`.
 * @property {number} [maxNumPages] Max number of pages. Use the default of `-1` for all pages. Defaults to `-1`.
 * @property {number} [pageNumZeroPad] How many zeros to pad each json filename index with. Defaults to `0`.
 */

/**
 * @typedef {BaseStrapiOptions & StrapiCredentials} StrapiOptions
 */

/**
 * @typedef {Required<BaseStrapiOptions> & StrapiCredentials} StrapiOptionsAssembled
 */

/**
 * @satisfies {Partial<StrapiOptions>}
 */
const STRAPI_OPTION_DEFAULTS = {
	version: '3',
	limit: 100,
	maxNumPages: -1,
	pageNumZeroPad: 0
};

class StrapiVersionUtils {
	/**
   * @type {StrapiOptions}
   * @protected
   */
	config;

	/**
   * @type {import('@bluecadet/launchpad-utils').Logger}
   * @protected
   */
	logger;

	/**
   * @param {StrapiOptions} config
   * @param {import('@bluecadet/launchpad-utils').Logger} logger
   */
	constructor(config, logger) {
		this.config = config;
		this.logger = logger;
	}

	/**
   * @param {StrapiObjectQuery} query
   * @param {StrapiPagination} [pagination]
   * @returns {string}
   */
	buildUrl(query, pagination) {
		throw new Error('Not implemented');
	}

	/**
   * @param {StrapiObjectQuery} query
   * @returns {boolean}
   */
	hasPaginationParams(query) {
		throw new Error('Not implemented');
	}

	/**
   * @param {unknown} result
   * @returns {unknown[]}
   */
	transformResult(result) {
		if (!Array.isArray(result)) {
			throw new Error('Expected result to be an array');
		}

		return result;
	}

	/**
   * @param {unknown} result
   * @returns {boolean}
   */
	canFetchMore(result) {
		throw new Error('Not implemented');
	}

	/**
   * @param {string} string
   * @returns {StrapiObjectQuery}
   */
	parseQuery(string) {
		const url = new URL(string, this.config.baseUrl);
		const params = qs.parse(url.search.slice(1));
		const contentType = url.pathname.split('/').pop();

		if (contentType === undefined) {
			throw new Error(`Could not parse content type from query '${string}'`);
		}

		return { contentType, params };
	}
}

class StrapiV4 extends StrapiVersionUtils {
	/**
   * @param {StrapiObjectQuery} query
   * @param {StrapiPagination} [pagination]
   * @returns {string}
   */
	buildUrl(query, pagination) {
		const url = new URL(query.contentType, this.config.baseUrl);

		let params = query.params;

		// only add pagination params if they arent't specified in the query object
		if (!this.hasPaginationParams(query) && pagination) {
			params = {
				...params,
				pagination: {
					page: (pagination.start / pagination.limit) + 1,
					pageSize: pagination.limit,
					...params?.pagination
				}
			};
		}

		const search = qs.stringify(params, {
			encodeValuesOnly: true, // prettify url
			addQueryPrefix: true // add ? to beginning
		});

		url.search = search;

		return url.toString();
	}

	/**
   * @param {StrapiObjectQuery} query
   * @returns {boolean}
   */
	hasPaginationParams(query) {
		return query?.params?.pagination?.page !== undefined || query?.params?.pagination?.pageSize !== undefined;
	}

	/**
   * @param {{data: unknown[]}} result
   * @returns {unknown[]}
   */
	transformResult(result) {
		return result.data;
	}

	/**
   * @param {{meta?: {pagination?: {page: number, pageCount: number}}}} result
   * @returns {boolean}
   */
	canFetchMore(result) {
		if (result?.meta?.pagination) {
			const { page, pageCount } = result.meta.pagination;
			return page < pageCount;
		}

		return false;
	}
}

class StrapiV3 extends StrapiVersionUtils {
	/**
   * @param {StrapiObjectQuery} query
   * @param {StrapiPagination} [pagination]
   * @returns {string}
   */
	buildUrl(query, pagination) {
		const url = new URL(query.contentType, this.config.baseUrl);

		let params = query.params;

		// only add pagination params if they arent't specified in the query object
		if (!this.hasPaginationParams(query) && pagination) {
			params = {
				_start: pagination.start,
				_limit: pagination.limit,
				...params
			};
		}

		const search = qs.stringify(params, {
			encodeValuesOnly: true, // prettify url
			addQueryPrefix: true // add ? to beginning
		});

		url.search = search;

		return url.toString();
	}

	/**
   * @param {StrapiObjectQuery} query
   * @returns {boolean}
   */
	hasPaginationParams(query) {
		return query?.params?._start !== undefined || query?.params?._limit !== undefined;
	}

	/**
   * @param {unknown} result
   * @returns {boolean}
   */
	canFetchMore(result) {
		// strapi v3 doesn't have any pagination info in the response,
		// so we can't know if there are more results
		return true;
	}
}

/**
 * @private
 * @param {string} baseUrl
 * @param {string} identifier
 * @param {string} password
 * @returns {Promise<import('neverthrow').Result<string, string>>} The JSON web token generated by Strapi
 */
async function getJwt(baseUrl, identifier, password) {
	const url = new URL('/auth/local', baseUrl);

	return ky
		.post(url.toString(), {
			json: { identifier, password }
		})
		.json()
		.then(response => ok(response.jwt))
		.catch(error => err(`Could not get JWT for ${identifier}: ${error}`));
}

/**
 * @type {import("./source.js").ContentSourceBuilder<StrapiOptions>}
 */
export default async function strapiSource(options) {
	const assembledOptions = {
		...STRAPI_OPTION_DEFAULTS,
		...options
	};

	if (assembledOptions.version !== '4' && assembledOptions.version !== '3') {
		return err(configError(`Unsupported strapi version '${assembledOptions.version}'`));
	}

	/**
   * @type {string | undefined}
   */
	let token;

	if ('token' in assembledOptions) {
		token = assembledOptions.token;
	} else {
		const jwtResult = await getJwt(assembledOptions.baseUrl, assembledOptions.identifier, assembledOptions.password);

		if (jwtResult.isErr()) {
			return err(configError(jwtResult.error));
		}

		token = jwtResult.value;
	}

	return ok(defineSource({
		id: options.id,
		fetch: async (ctx) => {
			/**
       * @type {StrapiVersionUtils}
       */
			const versionUtils = assembledOptions.version === '4' ? new StrapiV4(assembledOptions, ctx.logger) : new StrapiV3(assembledOptions, ctx.logger);

			const results = new Map();

			for (const query of assembledOptions.queries) {
				/**
             * @type {StrapiObjectQuery}
             */
				let parsedQuery;

				if (typeof query === 'string') {
					parsedQuery = versionUtils.parseQuery(query);
				} else {
					parsedQuery = query;
				}
            
				const fetchResults = await fetchPaginated({
					fetchPageFn: async (params) => {
						const pageNum = params.offset / params.limit;

						if (pageNum > assembledOptions.maxNumPages) {
							return ok(null);
						}

						ctx.logger.debug(`Fetching page ${pageNum} of ${parsedQuery.contentType}`);

						const req = await ky(versionUtils.buildUrl(parsedQuery, {
							start: params.offset,
							limit: params.limit
						}), {
							headers: {
								Authorization: `Bearer ${token}`
							}
						});

						if (!req.ok) {
							return err(fetchError(req.statusText));
						}

						const parsed = await ResultAsync.fromThrowable(req.json)();
            
						if (parsed.isErr()) {
							return err(parseError(`Could not parse response from ${req.url}`));
						}
            
						const transformedContent = versionUtils.transformResult(parsed.value);

						if (!transformedContent || !transformedContent.length) {
							return ok(null);
						}

						return ok(transformedContent);
					},
					limit: assembledOptions.limit,
					logger: ctx.logger,
					meta: {
						key: parsedQuery.contentType
					}
				});

				if (fetchResults.isErr()) {
					return err(fetchResults.error);
				}

				let i = 0;
				for (const content of fetchResults.value.pages) {
					const fileName = `${parsedQuery.contentType}-${i.toString().padStart(assembledOptions.pageNumZeroPad, '0')}.json`;
					results.set(fileName, content);
					i++;
				}
			}

			return ok(results);
		}
	}));
}