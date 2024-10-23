import { err, errAsync, ok, ResultAsync } from 'neverthrow';
import { defineSource } from './source.js';
import { configError, fetchError } from './source-errors.js';
import { fetchPaginated } from '../utils/fetch-paginated.js';

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
 * @typedef {BaseContentfulOptions & ContentfulClientParams & ContentfulCredentials} ContentfulOptions
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
 * @type {import("./source.js").ContentSourceBuilder<ContentfulOptions>}
 */
export default function contentfulSource(options) {
	const assembled = {
		accessToken: '',
		...CONTENTFUL_OPTIONS_DEFAULTS,
		...options
	};

	if (assembled.usePreviewApi) {
		if (!assembled.previewToken) {
			return errAsync(configError('usePreviewApi is set to true, but no previewToken is provided'));
		}
		assembled.accessToken = assembled.previewToken;
	} else {
		if (!('deliveryToken' in assembled) || !assembled.deliveryToken) {
			return errAsync(configError('usePreviewApi is set to false, but no deliveryToken is provided'));
		}

		assembled.accessToken = assembled.deliveryToken;
	}

	return ResultAsync.fromPromise(import('contentful'), () => configError('Could not find module "contentful". Make sure you have installed it.'))
		.andThen(({ createClient }) => {
			const client = createClient(assembled);

			return ok(defineSource({
				id: options.id,
				fetch: (ctx) => {
					// const fetchResult = await fetchPage(client, assembled.searchParams);

					// complicated type cast to make TS happy – difficult to get fetchPaginated to infer the type correctly
					/** @type {ReturnType<typeof fetchPaginated<{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[]}>>} */
					const fetchResult = fetchPaginated({
						fetchPageFn: (params) => {
							return ResultAsync.fromPromise(client.getEntries({ ...assembled.searchParams, skip: params.offset, limit: params.limit }), (error) => fetchError(`Error fetching page: ${error instanceof Error ? error.message : error}`))
								.andThen((rawPage) => {
									if (rawPage.errors) {
										return err(fetchError(`Error fetching page: ${rawPage.errors.map(e => e.message).join(', ')}`));
									}

									const page = rawPage.toPlainObject();
									const entries = parseEntries(page);
									const assets = parseAssets(page);

									if (!entries.length) {
										return ok(null); // No more pages left
									}

									return ok({
										entries,
										assets
									});
								});
						},
						limit: options.searchParams.limit,
						logger: ctx.logger
					});

					return fetchResult.andThen((fetchResult) => {
						const result = new Map();

						// combine page results
						const combined = fetchResult.pages.reduce((acc, page) => {
							return {
								entries: [...acc.entries, ...page.entries],
								assets: [...acc.assets, ...page.assets]
							};
						}, /** @type {{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[]}} */({ entries: [], assets: [] }));

						result.set(assembled.filename, combined);

						return ok(result);
					});
				}
			}));
		});
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
