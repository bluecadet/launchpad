import type { Asset, Entry } from "contentful";
import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { fetchPaginated } from "../utils/fetch-paginated.js";
import { SourceConfigError, SourceFetchError, SourceMissingDependencyError, defineSource } from "./source.js";

type ContentfulCredentialsDeliveryToken = {
	/**
	 * Content delivery token (all published content).
	 */
	deliveryToken: string;
	/**
	 * Content preview token (only unpublished/draft content).
	 */
	previewToken?: string;
};

type ContentfulCredentialsPreviewToken = {
	/**
	 * Content preview token (only unpublished/draft content).
	 */
	previewToken: string;
};

type BaseContentfulOptions = {
	/**
	 * Required field to identify this source. Will be used as download path.
	 */
	id: string;
	/**
	 * Your Contentful space ID. Note that an accessToken is required in addition to this
	 */
	space: string;
	/**
	 * Optional. Used to pull localized images.
	 */
	locale?: string;
	/**
	 * Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to 'content.json'
	 */
	filename?: string;
	/**
	 * Optional. Defaults to 'https'
	 */
	protocol?: string;
	/**
	 * Optional. Defaults to 'cdn.contentful.com', or 'preview.contentful.com' if `usePreviewApi` is true
	 */
	host?: string;
	/**
	 * Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false
	 */
	usePreviewApi?: boolean;
	/**
	 * Optionally limit queries to these content types. This will also apply to linked assets. Types that link to other types will include up to 10 levels of child content. E.g. filtering by Story, might also include Chapters and Images. Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.
	 */
	contentTypes?: Array<string>;
	/**
	 * Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters
	 */
	searchParams?: Record<string, unknown>;
};

type ContentfulClientParams = Omit<import("contentful").CreateClientParams, keyof BaseContentfulOptions | "accessToken">;

/**
 * Configuration options for the Contentful ContentSource.
 *
 * Also supports all fields of the Contentful SDK's config.
 *
 * @see Configuration under https://contentful.github.io/contentful.js/contentful/9.1.7/
 */
type ContentfulOptions = BaseContentfulOptions & ContentfulClientParams & (ContentfulCredentialsDeliveryToken | ContentfulCredentialsPreviewToken);

const CONTENTFUL_OPTIONS_DEFAULTS = {
	locale: "en-US",
	filename: "content.json",
	protocol: "https",
	host: "cdn.contentful.com",
	usePreviewApi: false,
	contentTypes: [],
	searchParams: {
		limit: 1000, // This is the max that Contentful supports,
		include: 10, // @see https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/links/retrieval-of-linked-items
	} as Record<string, unknown>,
} satisfies Partial<BaseContentfulOptions>;

export default function contentfulSource(options: ContentfulOptions) {
	const assembled = {
		accessToken: "",
		...CONTENTFUL_OPTIONS_DEFAULTS,
		...options,
	};

	if (assembled.usePreviewApi) {
		if (!assembled.previewToken) {
			return errAsync(new SourceConfigError("usePreviewApi is set to true, but no previewToken is provided"));
		}
		assembled.host = "preview.contentful.com";
		assembled.accessToken = assembled.previewToken;
	} else {
		if (!("deliveryToken" in assembled) || !assembled.deliveryToken) {
			return errAsync(new SourceConfigError("usePreviewApi is set to false, but no deliveryToken is provided"));
		}

		assembled.accessToken = assembled.deliveryToken;
	}

	if (assembled.contentTypes && assembled.contentTypes.length > 0) {
		assembled.searchParams["sys.contentType.sys.id[in]"] = assembled.contentTypes.join(",");
	}

	return ResultAsync.fromPromise(
		import("contentful"),
		() => new SourceMissingDependencyError('Could not find module "contentful". Make sure you have installed it.'),
	).map(({ createClient }) => {
		const client = createClient(assembled);

		/** @type {import('./source.js').ContentSource<{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[]}>} */
		const source = defineSource({
			id: options.id,
			fetch: (ctx) => {
				// complicated type cast to make TS happy – difficult to get fetchPaginated to infer the type correctly
				/** @type {ReturnType<typeof fetchPaginated<{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[]}>>} */
				const fetchResult = fetchPaginated({
					fetchPageFn: (params) => {
						return ResultAsync.fromPromise(
							client.getEntries({ ...assembled.searchParams, skip: params.offset, limit: params.limit }),
							(error) => new SourceFetchError(`Error fetching page: ${error instanceof Error ? error.message : error}`),
						).andThen((rawPage) => {
							if (rawPage.errors) {
								return err(new SourceFetchError(`Error fetching page: ${rawPage.errors.map((e) => e.message).join(", ")}`));
							}

							const page = rawPage.toPlainObject();
							const entries = parseEntries(page);
							const assets = parseAssets(page);

							if (!entries.length) {
								return ok(null); // No more pages left
							}

							return ok({
								entries,
								assets,
							});
						});
					},
					limit: assembled.searchParams.limit as number,
					logger: ctx.logger,
				});

				return ok([
					{
						id: assembled.filename,
						dataPromise: fetchResult.map(({ pages }) => {
							// combine page results
							const combined = pages.reduce(
								(acc, page) => {
									return {
										entries: [...acc.entries, ...page.entries],
										assets: [...acc.assets, ...page.assets],
									};
								},
								/** @type {{entries: import('contentful').Entry<unknown>[], assets: import('contentful').Asset[]}} */ ({ entries: [], assets: [] }),
							);

							return [
								{
									id: assembled.filename,
									data: combined,
								},
							];
						}),
					},
				]);
			},
		});

		return source;
	});
}

/**
 * Returns all entries from a sync() or getEntries() response object.
 */

// biome-ignore lint/suspicious/noExplicitAny: unknown type from CMS
function parseEntries(responseObj: any): Array<Entry<unknown>> {
	const entries = responseObj.entries || [];
	if (responseObj.items) {
		for (const item of responseObj.items) {
			if (item?.sys && item.sys.type === "Entry") {
				entries.push(item);
			}
		}
	}
	return entries;
}

/**
 * Returns all entries from a sync() or getEntries() response object.
 */
// biome-ignore lint/suspicious/noExplicitAny: unknown type from CMS
function parseAssets(responseObj: any): Array<Asset> {
	const assets = responseObj.assets || [];
	if (responseObj.includes) {
		// 'includes' is an object where the key = type, and the value = list of items
		for (const [key, items] of Object.entries(responseObj.includes)) {
			if (key === "Asset") {
				assets.push(...(items as Array<Asset>));
			}
		}
	}
	return assets;
}
