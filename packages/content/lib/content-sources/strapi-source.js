/**
 * @module strapi-source
 */

import chalk from 'chalk';
import jsonpath from 'jsonpath';
import got from 'got';
import qs from 'qs';

import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * @typedef {Object} StrapiObjectQuery
 * @property {string} contentType The content type to query
 * @property {Object} params Query parameters. Uses `qs` library to stringify.
 */

/**
 * Options for StrapiSource
 */
export class StrapiOptions extends SourceOptions {
	constructor({
		version = '3',
		baseUrl = undefined,
		queries = [],
		limit = 100,
		maxNumPages = -1,
		pageNumZeroPad = 0,
		identifier = undefined,
		password = undefined,
		token = undefined,
		...rest
	} = {}) {
		super(rest);
		
		/**
		 * Versions `3` and `4` are supported.
		 * @type {'3'|'4'}
		 * @default '3'
		 */
		this.version = version;
		
		/**
		 * The base url of your Strapi CMS (with or without trailing slash).
		 * @type {string}
		 */
		this.baseUrl = baseUrl;
		
		/**
		 * Queries for each type of content you want to save. One per content type. Content will be stored  as numbered, paginated JSONs. You can include all query parameters supported by Strapi: https://docs-v3.strapi.io/developer-docs/latest/developer-resources/content-api/content-api.html#api-parameters
		 * You can also pass an object with a `contentType` and `params` property.
		 * @type {Array.<string | StrapiObjectQuery>}
		 * @default []
		 */
		this.queries = queries;
		
		/**
		 * Max number of entries per page.
		 * @type {number}
		 * @default 100
		 */
		this.limit = limit;
		
		/**
		 * Max number of pages. Use the default of `-1` for all pages
		 * @type {number}
		 * @default -1
		 */
		this.maxNumPages = maxNumPages;
		
		/**
		 * How many zeros to pad each json filename index with.
		 * @type {number}
		 * @default 0
		 */
		this.pageNumZeroPad = pageNumZeroPad;
		
		/**
		 * Username or email. Should be configured via `./credentials.json`
		 * @type {string}
		 */
		this.identifier = identifier;
		
		/**
		 * Should be configured via `./credentials.json`
		 * @type {string}
		 */
		this.password = password;
		
		/**
		 * Can be used instead of identifer/password if you previously generated one. Otherwise this will be automatically generated using the identifier or password.
		 * @type {string}
		 */
		this.token = token;
	}
}

/**
 * @typedef {Object} StrapiPagination
 * @property {number} start The index of the first item to fetch
 * @property {number} limit The number of items to fetch
 */

class StrapiVersionUtils {
	/**
	 * @type {StrapiOptions}
	 * @private
	 */
	config;

	/**
	 * @type {Logger}
	 * @private
	 */
	logger;

	/**
	 * @param {StrapiOptions}
	 * @param {Logger}
	 */
	constructor(config, logger) {
		this.config = config;
		this.logger = logger;
	}
	
	/**
	 * @param {StrapiObjectQuery} query
	 * @returns {string}
	 */
	buildUrl(query) {
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
	 * @param {object} result
	 * @returns {object}
	 */
	transformResult(result) {
		return result;
	}

	/**
	 * @param {object} result
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
		if (!this.hasPaginationParams(query)) {
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
	 * @param {object} result
	 * @returns {object}
	 */
	transformResult(result) {
		return result.data;
	}

	/**
	 * @param {object} result
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
		if (!this.hasPaginationParams(query)) {
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
	 * @param {object} result
	 * @returns {boolean}
	 */
	canFetchMore(result) {
		// strapi v3 doesn't have any pagination info in the response,
		// so we can't know if there are more results
		return true;
	}
}

class StrapiSource extends ContentSource {
	/**
	 * @type {StrapiVersionUtils}
	 * @private
	 */
	_versionUtils;

	/**
	 * 
	 * @param {*} config 
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
		
		if (!this.config.token) {
			this.config.token = await this._getJwt(this.config.identifier, this.config.password);
		}
		
		for (const query of this.config.queries) {
			await this._fetchPages(query, this.config.token, result, {
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
		if (typeof query === 'string') {
			query = this._versionUtils.parseQuery(query);
		}

		const pageNum = pagination.start / pagination.limit;
		
		const fileName = `${query.contentType}-${pageNum.toString().padStart(this.config.pageNumZeroPad, '0')}.json`;
		
		this.logger.debug(`Fetching page ${pageNum} of ${query.contentType}`);

		return got(this._versionUtils.buildUrl(query, pagination), {
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
					!this._versionUtils.hasPaginationParams(query) &&
					(this.config.maxNumPages < 0 || pageNum < this.config.maxNumPages - 1) &&
					this._versionUtils.canFetchMore(content)
				) {
					// Fetch next page
					pagination.start = pagination.start || 0;
					pagination.start += pagination.limit;
					return this._fetchPages(query, jwt, result, pagination);
				} else {
					// Return combined entries + assets
					return Promise.resolve(result);
				}
			})
			.catch((error) => {
				this.logger.error(chalk.red(`Could not fetch page: ${error ? error.message || '' : ''}`));
			});
	}
	
	/**
	 * 
	 * @param {Object} content 
	 * @return @type {Array.<string>}
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
	
	async _getJwt(identifier, password) {
		this.logger.info(chalk.gray(`Retrieving JWT for ${identifier}...`));
		
		const url = new URL('/auth/local', this.config.baseUrl);
		
		return got
			.post(url.toString(), {
				form: {
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
	 * 
	 * @param {*} config 
	 * @returns {StrapiOptions}
	 */
	static _assembleConfig(config) {
		return new StrapiOptions({
			...config,
			...Credentials.getCredentials(config.id)
		});
	}
}

export default StrapiSource;
