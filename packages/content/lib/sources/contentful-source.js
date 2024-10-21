/**
 * @typedef ContentfulCredentialsDeliveryToken
 * @property {string} deliveryToken Content delivery token (all published content).
 * @property {string} [previewToken] Content preview token (only unpublished/draft content).
 */

import { err, ok } from 'neverthrow';
import { defineSource } from './source.js';

/**
 * @typedef ContentfulCredentialsPreviewToken
 * @property {string} previewToken Content preview token (only unpublished/draft content).
 */

/**
 * @typedef { ContentfulCredentialsDeliveryToken | ContentfulCredentialsPreviewToken} ContentfulCredentials
 */

/**
 * @typedef BaseContentfulOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {string} space Your Contentful space ID. Note that an accessToken is required in addition to this
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
 * @typedef {BaseContentfulOptions & ContentfulClientParams} ContentfulOptions
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

async function getContentful() {
	// async import because it's an optional dependency
	try {
		const contentful = await import('contentful');
		return ok(contentful.default);
	} catch (error) {
		return err('Could not find module "contentful". Make sure you have installed it.');
	}
}

/**
 * @param {ContentfulOptions} config 
 */
function assembleConfig(config) {
	const assembled = {
		accessToken: '',
		...CONTENTFUL_OPTIONS_DEFAULTS,
		...config
	};
  
	if (!('deliveryToken' in config) && 'previewToken' in config) {
		// if we only have a preview token, use the preview API
		assembled.usePreviewApi = true;
	}

	if (assembled.usePreviewApi) {
		assembled.host = 'preview.contentful.com';
	}
  
	if ('accessToken' in config && typeof config.accessToken === 'string') {
		// if access token is set, use it
		assembled.accessToken = config.accessToken;
	} else if (assembled.usePreviewApi) {
		// if usePreviewApi is true, use previewToken
		if (!('previewToken' in config) || typeof config.previewToken !== 'string') {
			throw new Error(`usePreviewApi is set to true, but no previewToken is provided for '${config.id}'`);
		}
		assembled.accessToken = config.previewToken;
	} else {
		// otherwise just use deliveryToken
		if (!('deliveryToken' in config) || typeof config.deliveryToken !== 'string') {
			throw new Error(`no deliveryToken is provided for '${config.id}'`);
		}
		assembled.accessToken = config.deliveryToken;
	}

	if (assembled.contentTypes && assembled.contentTypes.length > 0) {
		assembled.searchParams['sys.contentType.sys.id[in]'] = assembled.contentTypes.join(',');
	}

	return assembled;
}

/**
	 * Returns all entries from a sync() or getEntries() response object.
	 * @param {*} responseObj 
 * @returns {Array<import('contentful').Entry<unknown>>} Array of entry objects.
 */
function parseEntries(responseObj) {
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
 * @returns {Array<import('contentful').Asset>} Array of entry objects.
 */
function parseAssets(responseObj) {
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
 * Recursively fetches content using the Contentful client.
 * 
 * @param {import('contentful').ContentfulClientApi} client
 * @param {any} searchParams
 * @param {{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[], numPages: number}} result
 */
async function fetchPage(client, searchParams = {}, result = { entries: [], assets: [], numPages: 0 }) {
	const rawPage = await client.getEntries(searchParams);

	if (rawPage.errors) {
		return err(`Error fetching page: ${rawPage.errors.map(e => e.message).join(', ')}`);
	}

	const page = rawPage.toPlainObject();
	result.numPages++;
	result.entries.push(...parseEntries(page));
	result.assets.push(...parseAssets(page));

	if (rawPage.limit + rawPage.skip < rawPage.total) {
		// Fetch next page
		searchParams.skip = searchParams.skip || 0;
		searchParams.skip += rawPage.limit;
		return fetchPage(client, searchParams, result);
	} else {
		return ok(result);
	}
}

/**
 * @type {import("./source.js").ContentSourceBuilder<ContentfulOptions>}
 */
export default async function contentfulSource(options) {
	const assembledOptions = assembleConfig(options);

	const contentful = await getContentful();

	if (contentful.isErr()) {
		return contentful;
	}

	const client = contentful.value.createClient(assembledOptions);

	return ok(defineSource({
		id: options.id,
		fetch: async (ctx) => {
			const fetchResult = await fetchPage(client, assembledOptions.searchParams);

			if (fetchResult.isErr()) {
				return err(fetchResult.error);
			}

			const result = new Map();

			result.set(assembledOptions.filename, fetchResult.value);

			return ok(result);
		}
	}));
}
