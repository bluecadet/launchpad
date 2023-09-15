/**
 * @module contentful-source
 */

import contentful from 'contentful';
import ContentSource from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * @typedef ContentfulCredentialsAccessToken
 * @property {string} accessToken LEGACY: For backwards compatibility you can only set the `"accessToken"` using your delivery or preview token and a combination of the usePreviewApi flag.
 */

/**
 * @typedef ContentfulCredentialsDeliveryToken
 * @property {string} deliveryToken Content delivery token (all published content).
 * @property {string} [previewToken] Content preview token (only unpublished/draft content).
 */

/**
 * @typedef ContentfulCredentialsPreviewToken
 * @property {string} previewToken Content preview token (only unpublished/draft content).
 */

/**
 * @typedef {ContentfulCredentialsAccessToken | ContentfulCredentialsDeliveryToken | ContentfulCredentialsPreviewToken} ContentfulCredentials
 */

/**
 * @typedef BaseContentfulOptions
 * @property {string} space Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this
 * @property {string} [locale] Optional. Used to pull localized images.
 * @property {string} [filename] Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to 'content.json'
 * @property {string} [protocol] Optional. Defaults to 'https'
 * @property {string} [host] Optional. Defaults to 'cdn.contentful.com'
 * @property {boolean} [usePreviewApi] Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false
 * @property {Array<string>} [contentTypes] Optionally limit queries to these content types. This will also apply to linked assets. Types that link to other types will include up to 10 levels of child content. E.g. filtering by Story, might also include Chapters and Images. Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.
 * @property {any} [searchParams] Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters
 * @property {any} [imageParams] Optional. Applies to all images. Defaults to empty object. **IMPORTANT:** If you change the parameters, you will have to delete all cached images since the modified date of the original image will not have changed.
 */

/**
 * @typedef {Omit<import('contentful').CreateClientParams, keyof BaseContentfulOptions | 'accessToken'>} ContentfulClientParams
 */

/**
 * Configuration options for the Contentful ContentSource.
 *
 * Also supports all fields of the Contentful SDK's config.
 *
 * @see Configuration under https://contentful.github.io/contentful.js/contentful/9.1.7/
 * 
 * @typedef {import('./content-source.js').SourceOptions<'contentful'> & BaseContentfulOptions & ContentfulClientParams & (ContentfulCredentials | {})} ContentfulOptions
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'contentful'> & Required<BaseContentfulOptions> & ContentfulClientParams & {accessToken: string}} ContentfulOptionsAssembled
 */

/** 
 * @satisfies {Partial<BaseContentfulOptions>} 
 */
const CONTENTFUL_OPTIONS_DEFAULTS = {
	locale: 'en-US',
	filename: 'content.json',
	protocol: 'https',
	host: 'cdn.contentful.com',
	usePreviewApi: false,
	contentTypes: [],
	searchParams: {
		limit: 1000, // This is the max that Contentful supports,
		include: 10 // @see https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/links/retrieval-of-linked-items
	},
	imageParams: {}
};

/**
 * @extends {ContentSource<ContentfulOptionsAssembled>}
 */
class ContentfulSource extends ContentSource {
	/** @type {contentful.ContentfulClientApi} */
	client;

	/**
	 * @param {ContentfulOptions} config 
	 * @param {Logger} logger 
	 */
	constructor(config, logger) {
		super(ContentfulSource._assembleConfig(config), logger);
		if (this.config.usePreviewApi) {
			this.logger.info(`Using preview API for Contentful source '${this.config.id}'`);
		}
		this.client = contentful.createClient(this.config);
	}

	/**
	 * @returns {Promise<ContentResult>}
	 */
	async fetchContent() {
		return this._fetchPage(this.config.searchParams)
			.then((content) => {
				const result = new ContentResult();
				result.addDataFile(this.config.filename, content);
				result.addMediaDownloads(
					this._getMediaUrls(content.assets).map(url => new MediaDownload({ url }))
				);
				return result;
			})
			.catch((err) => {
				return Promise.reject(new Error(`Could not fetch Contentful content: ${err.message}`));
			});
	}

	/**
	 * Recursively fetches content using the Contentful client.
	 *
	 * @param {any} searchParams
	 * @param {any} result
	 * @returns {Promise<{entries: unknown[], assets: unknown[]}>} Object with an 'entries' and an 'assets' array.
	 */
	async _fetchPage(searchParams = {}, result = {}) {
		result.entries = result.entries || [];
		result.assets = result.assets || [];
		result.numPages = result.numPages || 0;

		return (
			this.client
				.getEntries(searchParams)
				.then((rawPage) => {
					const page = rawPage.toPlainObject();
					result.numPages++;
					result.entries.push(...this._parseEntries(page));
					result.assets.push(...this._parseAssets(page));
					
					if (rawPage.limit + rawPage.skip < rawPage.total) {
						// Fetch next page
						searchParams.skip = searchParams.skip || 0;
						searchParams.skip += rawPage.limit;
						return this._fetchPage(searchParams, result);
					} else {
						// Return combined entries + assets
						return Promise.resolve(result);
					}
				})
				.catch((error) => {
					this.logger.error(`Sync failed: ${error ? error.message || '' : ''}`);
				})
		);
	}

	/**
	 * Returns all entries from a sync() or getEntries() response object.
	 * @param {*} responseObj 
	 * @returns {Array<contentful.Entry<unknown>>} Array of entry objects.
	 */
	_parseEntries(responseObj) {
		const entries = responseObj.entries || [];
		if (responseObj.items) {
			for (const item of responseObj.items) {
				if (item && item.sys && item.sys.type === 'Entry') {
					entries.push(item);
				}
			}
		}
		return entries;
	}
	
	/**
	 * Returns all entries from a sync() or getEntries() response object.
	 * @param {*} responseObj 
	 * @returns {Array<contentful.Asset>} Array of entry objects.
	 */
	_parseAssets(responseObj) {
		const assets = responseObj.assets || [];
		if (responseObj.includes) {
			// 'includes' is an object where the key = type, and the value = list of items
			for (const [key, items] of Object.entries(responseObj.includes)) {
				if (key === 'Asset') {
					assets.push(...items);
				}
			}
		}
		return assets;
	}

	/**
	 * Extracts all media urls from a list of Contentful asset objects
	 * @param {*} assets The list of assets from the Contentful API
	 * @returns {Array<string>}
	 */
	_getMediaUrls(assets) {
		const urls = [];

		for (const asset of assets) {
			if (asset.fields && asset.fields.file) {
				const file = asset.fields.file;
				const locale = this.config.locale;

				let url = '';

				if (!file) {
					this.logger.error(file);
				} else if (locale && file[locale] && file[locale].url) {
					url = file[locale].url;
				} else if (file && file.url) {
					url = file.url;
				}
				
				if (!url) {
					continue;
				}

				if (!url.includes('http') && !url.includes('https')) {
					url = `${this.config.protocol}:${url}`;
				}
				
				if (this.config.imageParams) {
					for (const [key, value] of Object.entries(this.config.imageParams)) {
						url += (url.includes('?') ? '&' : '?') + `${key}=${value}`;
					}
				}
				urls.push(url);
			}
		}
		
		return urls;
	}

	/**
	 * @param {ContentfulOptions} config
	 * @returns {ContentfulOptionsAssembled}
	 */
	static _assembleConfig(config) {
		const creds = Credentials.getCredentials(config.id);

		/**
		 * @type {ContentfulCredentials}
		 */
		let validatedCredentials;

		if (creds) {
			if (!ContentfulSource._validateCrendentials(creds)) {
				throw new Error(`Contentful credentials for '${config.id}' are invalid`);
			}

			validatedCredentials = creds;
		} else {
			if (!ContentfulSource._validateCrendentials(config)) {
				throw new Error(`No Contentful credentials found for '${config.id}' in credentials file or launchpad config.`);
			}

			validatedCredentials = config;
		}

		const assembled = {
			accessToken: '',
			...CONTENTFUL_OPTIONS_DEFAULTS,
			...config
		};
		
		if (!('deliveryToken' in validatedCredentials) && 'previewToken' in validatedCredentials) {
			// if we only have a preview token, use the preview API
			assembled.usePreviewApi = true;
		}

		if (assembled.usePreviewApi) {
			assembled.host = 'preview.contentful.com';
		}
		
		if ('accessToken' in validatedCredentials) {
			// if access token is set, use it
			assembled.accessToken = validatedCredentials.accessToken;
		} else if (assembled.usePreviewApi) {
			// if usePreviewApi is true, use previewToken
			if (!('previewToken' in validatedCredentials) || !validatedCredentials.previewToken) {
				throw new Error(`usePreviewApi is set to true, but no previewToken is provided for '${config.id}'`);
			}
			assembled.accessToken = validatedCredentials.previewToken;
		} else {
			// otherwise just use deliveryToken
			if (!('deliveryToken' in validatedCredentials) || !validatedCredentials.deliveryToken) {
				throw new Error(`no deliveryToken is provided for '${config.id}'`);
			}
			assembled.accessToken = validatedCredentials.deliveryToken;
		}

		if (assembled.contentTypes && assembled.contentTypes.length > 0) {
			assembled.searchParams['sys.contentType.sys.id[in]'] = assembled.contentTypes.join(',');
		}

		return assembled;
	}

	/**
	 * @private
	 * @param {unknown} creds 
	 * @returns {creds is ContentfulCredentials}
	 */
	static _validateCrendentials(creds) {
		if (typeof creds !== 'object' || creds === null) {
			return false;
		}

		return 'accessToken' in creds || 'deliveryToken' in creds || 'previewToken' in creds;
	}
}

export default ContentfulSource;
