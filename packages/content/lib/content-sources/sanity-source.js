/**
 * @module sanity-source
 */

import chalk from 'chalk';
import jsonpath from 'jsonpath';
import path from 'path';
import sanitize from 'sanitize-filename';

import {createClient} from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url';

import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';
import FileUtils from '../utils/file-utils.js';

/**
 * Options for SanitySource
 */
export class SanityOptions extends SourceOptions {
	/**
	 * @param {any} options
	 */
	constructor({
		apiVersion = 'v2021-10-21',
		projectId = undefined,
		dataset = 'production',
		apiToken = undefined,
		useCdn = false,
		baseUrl = undefined,
		queries = [],
		limit = 100,
		maxNumPages = -1,
		mergePages = false,
		pageNumZeroPad = 0,
		appendCroppedFilenames = true,
		...rest
	} = {}) {
		super(rest);

		/**
		 * API Version
		 * @type {string}
		 * @default 'v2021-10-21'
		 */
		this.apiVersion = apiVersion;

		/**
		 * Sanity Project ID
		 * @type {string}
		 */
		this.projectId = projectId;

		/**
		 * API Version
		 * @type {string}
		 * @default 'production'
		 */
		this.dataset = dataset;

		/**
		 * `false` if you want to ensure fresh data
		 * @type {boolean}
		 * @default false
		 */
		this.useCdn = useCdn;

		/**
		 * The base url of your Sanity CMS (with or without trailing slash).
		 * @type {string}
		 */
		this.baseUrl = baseUrl;

		/**
		 * @type {Array.<string | {query: string, id: string}>}
		 */
		this.queries = queries;

		/**
		 * Max number of entries per page.
		 * @type {number}
		 * @default 100
		 */
		this.limit = limit;

		/**
		 * Max number of pages. Use `-1` for all pages
		 * @type {number}
		 * @default -1
		 */
		this.maxNumPages = maxNumPages;

		/**
		 * To combine paginated files into a single file.
		 * @type {boolean}
		 */
		this.mergePages = mergePages;

		/**
		 * How many zeros to pad each json filename index with.
		 * @type {number}
		 * @default 0
		 */
		this.pageNumZeroPad = pageNumZeroPad;
		
		/**
		 * If an image has a crop set within Sanity, this setting will append the cropped filename to each image object as `launchpad.croppedFilename`. Set this to `false` to disable this behavior.
		 * @type {boolean}
		 * @default true
		 */
		this.appendCroppedFilenames = appendCroppedFilenames;

		/**
		 * API Token defined in your sanity project.
		 * @type {string}
		 */
		this.apiToken = apiToken;
	}
}

/**
 * @extends ContentSource<SanityOptions>
 */
class SanitySource extends ContentSource {
	/**
	 *
	 * @param {*} config
	 * @param {Logger} logger
	 */
	constructor(config, logger) {
		super(SanitySource._assembleConfig(config), logger);

		this._checkConfigDeprecations(this.config);

		this.client = createClient({
			projectId: this.config.projectId,
			dataset: this.config.dataset,
			apiVersion: this.config.apiVersion, // use current UTC date - see "specifying API version"!
			token: this.config.apiToken, // or leave blank for unauthenticated usage
			useCdn: this.config.useCdn // `false` if you want to ensure fresh data
		});
	}

	/**
	 * @returns {Promise<ContentResult>}
	 */
	async fetchContent() {
		/**
		 * @type {Array.<Promise<ContentResult>>}
		 */
		const queryPromises = [];

		/**
		 * @type {Array.<Promise<ContentResult>>}
		 */
		const customQueryPromises = [];

		for (const query of this.config.queries) {
			if (typeof query === 'string') {
				const queryFull = '*[_type == "' + query + '" ]';
				const result = new ContentResult();

				queryPromises.push(
					this._fetchPages(query, queryFull, result, {
						start: 0,
						limit: this.config.limit
					})
				);
			} else {
				const result = new ContentResult();
				customQueryPromises.push(
					this._fetchPages(query.id, query.query, result, {
						start: 0,
						limit: this.config.limit
					})
				);
			}
		}

		return Promise.all([...queryPromises, ...customQueryPromises])
			.then((values) => {
				return ContentResult.combine(values);
			})
			.catch((error) => {
				this.logger.error(`Sync failed: ${error ? error.message || '' : ''}`);
				return error;
			});
	}

	/**
	 * Recursively fetches content using the Sanity client.
	 *
	 * @param {string} id
	 * @param {string} query
	 * @param {ContentResult} result
	 * @param {{start: number, limit: number}} params
	 * @returns {Promise<ContentResult>} Object with an 'entries' and an 'assets' array.
	 */
	async _fetchPages(id, query, result, params = { start: 0, limit: 100 }) {
		const pageNum = params.start / params.limit || 0;
		const q =
			query +
			'[' +
			params.start +
			'..' +
			(params.start + params.limit - 1) +
			']';
		const p = {};

		this.logger.debug(`Fetching page ${pageNum} of ${id}`);

		return this.client
			.fetch(q, p)
			.then((content) => {
				if (!content || !content.length) {
					// If we are combining files, we do that here.
					if (this.config.mergePages) {
						result.collate(id);
					}

					// Empty result or no more pages left
					return Promise.resolve(result);
				}

				const fileName = `${id}-${pageNum
					.toString()
					.padStart(this.config.pageNumZeroPad, '0')}.json`;

				result.addDataFile(fileName, content);
				result.addMediaDownloads(this._getMediaDownloads(content));

				if (
					this.config.maxNumPages < 0 ||
					pageNum < this.config.maxNumPages - 1
				) {
					// Fetch next page
					params.start = params.start || 0;
					params.start += params.limit;
					return this._fetchPages(id, query, result, params);
				} else {
					// Return combined entries + assets
					return Promise.resolve(result);
				}
			})
			.catch((error) => {
				this.logger.error(
					chalk.red(`Could not fetch page: ${error ? error.message || '' : ''}`)
				);
				return Promise.reject(error);
			});
	}

	/**
	 *
	 * @param {Object} content
	 * @return {Array<MediaDownload>}
	 */
	_getMediaDownloads(content) {
		const downloads = [];

		// Get all raw URLs
		const rawAssetUrls = jsonpath.query(content, '$..url');
		for (let contentUrl of rawAssetUrls) {
			if (contentUrl.startsWith('/')) {
				const url = new URL(contentUrl, this.config.baseUrl);
				contentUrl = url.toString();
			}
			downloads.push(
				new MediaDownload({
					url: contentUrl
				})
			);
		}

		// Get derivative image URLs for crops/hotspots/etc
		const images = jsonpath.query(content, '$..*[?(@._type=="image")]');
		const builder = imageUrlBuilder(this.client);
		for (const image of images) {
			if (!('crop' in image)) {
				// Only process images with crop properties
				continue;
			}
			const urlBuilder = builder.image(image);
			const urlStr = urlBuilder.url();
			const url = new URL(urlStr);
			const task = new MediaDownload({
				url: urlStr
			});
			task.localPath = FileUtils.addFilenameSuffix(
				task.localPath,
				`_${sanitize(url.search.replace('?', ''))}`
			);
			
			if (this.config.appendCroppedFilenames) {
				image.launchpad = {
					croppedFilename: path.basename(task.localPath)
				};
			}
			
			downloads.push(task);
		}

		return downloads;
	}
	
	/**
	 *
	 * @param {*} config
	 */
	_checkConfigDeprecations(config) {
		if (config?.textConverters?.length > 0) {
			const exampleQuery = '\t"contentTransforms": {\n\t  "$..*[?(@._type==\'block\')]": ["sanityToPlain", "sanityToHtml", "sanityToMarkdown"]\n\t}';
			this.logger.warn(
				`The Sanity source "${chalk.yellow(
					'textConverters'
				)}" feature has been deprecated. Please use the following query instead (select only one transform):\n${chalk.green(
					exampleQuery
				)}`
			);
		}
	}
	
	/**
	 *
	 * @param {any} config
	 * @returns {SanityOptions}
	 */
	static _assembleConfig(config) {
		return new SanityOptions({
			...config,
			...Credentials.getCredentials(config.id)
		});
	}
}

export default SanitySource;
