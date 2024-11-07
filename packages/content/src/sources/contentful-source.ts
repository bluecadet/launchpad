import type { Asset, Entry } from "contentful";
import { z } from "zod";
import { fetchPaginated } from "../utils/fetch-paginated.js";
import { defineSource } from "./source.js";

// If deliveryToken is provided, then previewToken is optional.
const contentfulCredentialsSchema = z.union([
	z.object({
		/** Content delivery token (all published content). */
		deliveryToken: z.string().describe("Content delivery token (all published content)."),
		/** Content preview token (only unpublished/draft content). */
		previewToken: z
			.string()
			.optional()
			.describe("Content preview token (only unpublished/draft content)."),
	}),
	z.object({
		/** Content preview token (only unpublished/draft content). */
		previewToken: z.string().describe("Content preview token (only unpublished/draft content)."),
	}),
]);

const contentfulSourceSchema = z
	.object({
		/** Required field to identify this source. Will be used as download path. */
		id: z
			.string()
			.describe("Required field to identify this source. Will be used as download path."),
		/** Required field to identify this source. Will be used as download path. */
		space: z.string().describe("Your Contentful space ID."),
		/** Used to pull localized images. */
		locale: z.string().default("en-US").describe("Used to pull localized images."),
		/** The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to 'content.json' */
		filename: z
			.string()
			.default("content.json")
			.describe(
				"The filename you want to use for where all content (entries and assets metadata) will be stored.",
			),
		/** Optional. Defaults to 'https' */
		protocol: z.string().default("https").describe("Optional. Defaults to 'https'"),
		/** Optional. Defaults to 'cdn.contentful.com', or 'preview.contentful.com' if `usePreviewApi` is true */
		host: z
			.string()
			.default("cdn.contentful.com")
			.describe(
				"Optional. Defaults to 'cdn.contentful.com', or 'preview.contentful.com' if `usePreviewApi` is true",
			),
		/** Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false */
		usePreviewApi: z
			.boolean()
			.default(false)
			.describe(
				"Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false",
			),
		/**
		 * Optionally limit queries to these content types. This will also apply to linked assets.
		 * Types that link to other types will include up to 10 levels of child content. E.g. filtering by Story, might also include Chapters and Images.
		 * Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.
		 */
		contentTypes: z.array(z.string()).default([]).describe(
			"Optionally limit queries to these content types. This will also apply to linked assets. \
				Types that link to other types will include up to 10 levels of child content. E.g. filtering by Story, might also include Chapters and Images. \
				Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.",
		),
		/** Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters */
		searchParams: z.record(z.unknown()).default({
			limit: 1000, // This is the max that Contentful supports,
			include: 10, // @see https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/links/retrieval-of-linked-items
		}),
	})
	.passthrough()
	.and(contentfulCredentialsSchema);

export default async function contentfulSource(options: z.input<typeof contentfulSourceSchema>) {
	const assembled = contentfulSourceSchema.parse(options);

	let accessToken: string;

	if (assembled.usePreviewApi) {
		if (!assembled.previewToken) {
			throw new Error("usePreviewApi is set to true, but no previewToken is provided");
		}
		assembled.host = "preview.contentful.com";
		accessToken = assembled.previewToken;
	} else {
		if (!("deliveryToken" in assembled) || !assembled.deliveryToken) {
			throw new Error("usePreviewApi is set to false, but no deliveryToken is provided");
		}

		accessToken = assembled.deliveryToken as string;
	}

	if (assembled.contentTypes && assembled.contentTypes.length > 0) {
		assembled.searchParams["sys.contentType.sys.id[in]"] = assembled.contentTypes.join(",");
	}

	const { createClient } = await tryImportContentful();

	const client = createClient({
		...assembled,
		accessToken,
	});

	return defineSource({
		id: options.id,
		fetch: (ctx) => {
			return {
				id: assembled.filename,
				data: fetchPaginated({
					fetchPageFn: async (params) => {
						const rawPage = await client.getEntries({
							...assembled.searchParams,
							skip: params.offset,
							limit: params.limit,
						});

						if (rawPage.errors) {
							throw new Error(
								`Error fetching page: ${rawPage.errors.map((e) => e.message).join(", ")}`,
							);
						}

						const page = rawPage.toPlainObject();
						const entries = parseEntries(page);
						const assets = parseAssets(page);

						if (!entries.length) {
							return null; // No more pages left
						}

						return { entries, assets };
					},
					limit: assembled.searchParams.limit as number,
					logger: ctx.logger,
					mergePages: true,
				}).then((fetchResult) => {
					return fetchResult.reduce<{ entries: Entry<unknown>[]; assets: Asset[] }>(
						(acc, page) => {
							return {
								entries: [...acc.entries, ...page.entries],
								assets: [...acc.assets, ...page.assets],
							};
						},
						{ entries: [], assets: [] },
					);
				}),
			};
		},
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

async function tryImportContentful() {
	try {
		return await import("contentful");
	} catch (error) {
		throw new Error('Could not find module "contentful". Make sure you have installed it.', {
			cause: error,
		});
	}
}
