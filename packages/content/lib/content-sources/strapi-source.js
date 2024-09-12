/**
 * @module strapi-source
 */

import chalk from 'chalk';
import jsonpath from 'jsonpath';
import ky from 'ky';
import qs from 'qs';

import ContentSource from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';

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
 * @typedef {import('./content-source.js').SourceOptions<'strapi'> & BaseStrapiOptions & (StrapiCredentials | {})} StrapiOptions
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'strapi'> & Required<BaseStrapiOptions> & StrapiCredentials } StrapiOptionsAssembled
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
	 * @type {Logger | Console}
	 * @protected
	 */
	logger;

	/**
	 * @param {StrapiOptions} config
	 * @param {Logger | Console} logger
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
 * @extends {ContentSource<StrapiOptionsAssembled>}
 */
class StrapiSource extends ContentSource {
	/**
	 * @type {StrapiVersionUtils}
	 * @private
	 */
	_versionUtils;

	/**
	 * 
	 * @param {StrapiOptions} config 
	 * @param {Logger} logger
	 */
	constructor(config, logger) {
		super(StrapiSource._assembleConfig(config), logger);

		if (!this.config.version) {
			throw new Error('Strapi version not specified');
		} else if (parseInt(this.config.version) === 3) {
			this._versionUtils = new StrapiV3(this.config, this.logger);
		} else if (parseInt(this.config.version) === 4) {
			this._versionUtils = new StrapiV4(this.config, this.logger);
		} else {
			throw new Error(`Unsupported strapi version '${this.config.version}'`);
		}
		
		if (!this.config.queries || !this.config.queries.length) {
			throw new Error('No content queries defined');
		}
	}

	/**
	 * @returns {Promise<ContentResult>}
	 */
	async fetchContent() {
		const result = new ContentResult();

		/**
		 * @type {string | undefined}
		 */
		let token;
		
		if ('token' in this.config) {
			token = this.config.token;
		} else {
			if (!this.config.identifier || !this.config.password) {
				throw new Error('Either a token or an identifier and password must be provided for a Strapi source');
			}
			token = await this._getJwt(this.config.identifier, this.config.password);
		}
		
		for (const query of this.config.queries) {
			await this._fetchPages(query, token, result, {
				start: 0,
				limit: this.config.limit
			});
		}
		
		return result;
	}

	/**
	 * Recursively fetches content using the Strapi client.
	 *
	 * @param {string | StrapiObjectQuery} query
	 * @param {string} jwt The JSON web token generated by Strapi
	 * @param {ContentResult} result
	 * @param {StrapiPagination} pagination
	 * @returns {Promise<Object>} Object with an 'entries' and an 'assets' array.
	 */
	async _fetchPages(
		query,
		jwt,
		result,
		pagination = { start: 0, limit: 100 }
	) {
		/**
		 * @type {StrapiObjectQuery}
		 */
		let parsedQuery;

		if (typeof query === 'string') {
			parsedQuery = this._versionUtils.parseQuery(query);
		} else {
			parsedQuery = query;
		}

		const pageNum = pagination.start / pagination.limit;
		
		const fileName = `${parsedQuery.contentType}-${pageNum.toString().padStart(this.config.pageNumZeroPad, '0')}.json`;
		
		this.logger.debug(`Fetching page ${pageNum} of ${parsedQuery.contentType}`);

		return ky(this._versionUtils.buildUrl(parsedQuery, pagination), {
			headers: {
				Authorization: `Bearer ${jwt}`
			}
		})
			.json()
			.then((content) => {
				const transformedContent = this._versionUtils.transformResult(content);
				if (!transformedContent || !transformedContent.length) {
					// Empty result or no more pages left
					return Promise.resolve(result);
				}
				
				result.addDataFile(fileName, transformedContent);

				result.addMediaDownloads(
					this._getMediaUrls(transformedContent).map(url => new MediaDownload({ url }))
				);
				
				if (
					!this._versionUtils.hasPaginationParams(parsedQuery) &&
					(this.config.maxNumPages < 0 || pageNum < this.config.maxNumPages - 1) &&
					this._versionUtils.canFetchMore(content)
				) {
					// Fetch next page
					pagination.start = pagination.start || 0;
					pagination.start += pagination.limit;
					return this._fetchPages(parsedQuery, jwt, result, pagination);
				} else {
					// Return combined entries + assets
					return Promise.resolve(result);
				}
			})
			.catch((error) => {
				this.logger.error(chalk.red(`Could not fetch page: ${error ? error.message || '' : ''}`));
				return Promise.reject(result);
			});
	}
	
	/**
	 * @private
	 * @param {Object} content 
	 * @return {Array<string>}
	 */
	_getMediaUrls(content) {
		const contentUrls = jsonpath.query(content, '$..url');
		const mediaUrls = [];
		for (let contentUrl of contentUrls) {
			if (contentUrl.startsWith('/')) {
				const url = new URL(contentUrl, this.config.baseUrl);
				contentUrl = url.toString();
			}
			mediaUrls.push(contentUrl);
		}
		return mediaUrls;
	}
	
	/**
	 * @private
	 * @param {string} identifier
	 * @param {string} password
	 * @returns {Promise<string>} The JSON web token generated by Strapi
	 */
	async _getJwt(identifier, password) {
		this.logger.info(chalk.gray(`Retrieving JWT for ${identifier}...`));
		
		const url = new URL('/auth/local', this.config.baseUrl);
		
		return ky
			.post(url.toString(), {
				searchParams: {
					identifier,
					password
				}
			})
			.json()
			.then(response => {
				this.logger.info(chalk.green(`...retrieved JWT for ${chalk.white(identifier)}`));
				return response.jwt;
			})
			.catch(error => {
				this.logger.info(chalk.red(`Could not retrieve JWT for ${chalk.white(identifier)}`));
				this.logger.info(chalk.yellow(error));
				throw error;
			});
	}
	
	/**
	 * @private
	 * @param {StrapiOptions} config 
	 * @returns {StrapiOptionsAssembled}
	 */
	static _assembleConfig(config) {
		const creds = Credentials.getCredentials(config.id);

		if (creds) {
			if (!StrapiSource._validateCrendentials(creds)) {
				throw new Error(
					`Strapi credentials for source '${config.id}' are invalid.`
				);
			}
			
			return {
				...STRAPI_OPTION_DEFAULTS,
				...config,
				...creds
			};
		}

		if (!StrapiSource._validateCrendentials(config)) {
			throw new Error(
				`No Strapi credentials found for source '${config.id}' in credentials file or launchpad config.`
			);
		}

		return {
			...STRAPI_OPTION_DEFAULTS,
			...config
		};
	}

	/**
	 * @private
	 * @param {unknown} creds 
	 * @returns {creds is StrapiCredentials}
	 */
	static _validateCrendentials(creds) {
		if (typeof creds !== 'object' || creds === null) { return false; };

		return ('identifier' in creds && 'password' in creds) || 'token' in creds;
	}
}

export default StrapiSource;
