/**
 * @module sanity-source
 */

import chalk from 'chalk';
import jsonpath from 'jsonpath';
import path from 'path';
import sanitize from 'sanitize-filename';

import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

import ContentSource from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';
import FileUtils from '../utils/file-utils.js';


/**
 * @typedef BaseSanityOptions
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
 * @property {boolean} [appendCroppedFilenames] If an image has a crop set within Sanity, this setting will append the cropped filename to each image object as `launchpad.croppedFilename`. Set this to `false` to disable this behavior. Defaults to true.
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'sanity'> & BaseSanityOptions & (SanityCredentials | {})} SanityOptions
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'sanity'> & Required<BaseSanityOptions> & SanityCredentials} SanityOptionsAssembled
 */

const SANITY_OPTION_DEFAULTS = {
	apiVersion: 'v2021-10-21',
	dataset: 'production',
	useCdn: false,
	limit: 100,
	maxNumPages: -1,
	mergePages: false,
	pageNumZeroPad: 0,
	appendCroppedFilenames: true
};

/**
 * @extends ContentSource<SanityOptionsAssembled>
 */
class SanitySource extends ContentSource {
	/**
	 *
	 * @param {SanityOptions} config
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
	 * @param {unknown} content
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
	 * @param {SanityOptions} config
	 */
	_checkConfigDeprecations(config) {
		if ('textConverters' in config) {
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
	 * @private
	 * @param {SanityOptions} config
	 * @returns {SanityOptionsAssembled}
	 */
	static _assembleConfig(config) {
		const creds = Credentials.getCredentials(config.id);

		if (creds) {
			if (!SanitySource._validateCrendentials(creds)) {
				throw new Error(
					`Sanity credentials for source '${config.id}' are invalid.`
				);
			}

			return {
				...SANITY_OPTION_DEFAULTS,
				...config,
				...creds
			};
		}

		if (!SanitySource._validateCrendentials(config)) {
			throw new Error(
				`No Sanity credentials found for source '${config.id}' in credentials file or launchpad config.`
			);
		}

		return {
			...SANITY_OPTION_DEFAULTS,
			...config
		};
	}

	/**
	 * @private
	 * @param {unknown} creds 
	 * @returns {creds is SanityCredentials}
	 */
	static _validateCrendentials(creds) {
		return typeof creds === 'object' && creds !== null && 'apiToken' in creds;
	}
}

export default SanitySource;
