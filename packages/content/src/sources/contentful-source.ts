import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import type { Asset, Entry } from "contentful";
import { z } from "zod";
import { defineSource } from "../source.js";
import { fetchPaginated } from "../utils/fetch-paginated.js";

// If deliveryToken is provided, then previewToken is optional.
const contentfulCredentialsSchema = configSchema<ContentfulCredentials>()(
	z.union(
		[
			z.object({
				deliveryToken: z.string().describe("Content delivery token (all published content)."),
				previewToken: z
					.string()
					.optional()
					.describe("Content preview token (only unpublished/draft content)."),
			}),
			z.object({
				previewToken: z
					.string()
					.describe("Content preview token (only unpublished/draft content)."),
			}),
		],
		{
			error: (error) => {
				if (error.code === "invalid_union")
					return "You must provide either a `deliveryToken` or a `previewToken`.";

				return error.message ?? "";
			},
		},
	),
);

/** Contentful access tokens: a delivery token, a preview token, or both. */
export type ContentfulCredentials =
	| {
			/** Content delivery token (all published content). */
			deliveryToken: string;
			/** Content preview token (only unpublished/draft content). */
			previewToken?: string;
	  }
	| {
			/** Content preview token (only unpublished/draft content). */
			previewToken: string;
	  };

export interface ContentfulSourceBaseOptions {
	[key: string]: unknown;
	/** Required field to identify this source. Will be used as download path. */
	id: string;
	/** Your Contentful space ID. */
	space: string;
	/** Filename for all content (entries and assets metadata). Defaults to `"content.json"`. */
	filename?: string;
	/** Asset URL protocol. Defaults to `"https"`. */
	protocol?: string;
	/** Defaults to `"cdn.contentful.com"`, or `"preview.contentful.com"` if `usePreviewApi` is true. */
	host?: string;
	/** Use the preview API to view draft content. Defaults to `false`. */
	usePreviewApi?: boolean;
	/** Optionally limit queries to these content types. */
	contentTypes?: string[];
	/** Contentful search parameters. */
	searchParams?: Record<string, unknown>;
	/** Max request timeout in ms. Defaults to 60 seconds. */
	maxTimeout?: number;
}

export type ContentfulSourceOptions = ContentfulSourceBaseOptions & ContentfulCredentials;

const contentfulSourceSchema = configSchema<ContentfulSourceOptions>()(
	z
		.looseObject({
			id: z
				.string()
				.describe("Required field to identify this source. Will be used as download path."),
			space: z.string().describe("Your Contentful space ID."),
			filename: z
				.string()
				.default("content.json")
				.describe(
					"The filename you want to use for where all content (entries and assets metadata) will be stored.",
				),
			protocol: z.string().default("https").describe("Optional. Defaults to 'https'"),
			host: z
				.string()
				.default("cdn.contentful.com")
				.describe(
					"Optional. Defaults to 'cdn.contentful.com', or 'preview.contentful.com' if `usePreviewApi` is true",
				),
			usePreviewApi: z
				.boolean()
				.default(false)
				.describe(
					"Optional. Set to true if you want to use the preview API instead of the production version to view draft content. Defaults to false",
				),
			contentTypes: z.array(z.string()).default([]).describe(
				"Optionally limit queries to these content types. This will also apply to linked assets. \
				Types that link to other types will include up to 10 levels of child content. E.g. filtering by Story, might also include Chapters and Images. \
				Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.",
			),
			searchParams: z.record(z.string(), z.unknown()).default({
				limit: 1000, // This is the max that Contentful supports,
				include: 10, // @see https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/links/retrieval-of-linked-items
			}),
			maxTimeout: z.number().describe("Max request timeout in ms.").default(60_000),
		})
		.and(contentfulCredentialsSchema),
);

export default async function contentfulSource(options: ContentfulSourceOptions) {
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

	const createClient = await tryImportContentful();

	const client = createClient({
		...assembled,
		accessToken,
		timeout: assembled.maxTimeout,
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

						const entries = parseEntries(rawPage);
						const assets = parseAssets(rawPage, assembled.protocol);

						if (!entries.length) {
							return null; // No more pages left
						}

						return { entries, assets };
					},
					limit: assembled.searchParams.limit as number,
					logger: ctx.logger,
					mergePages: true,
				}).then((fetchResult) => {
					return fetchResult.reduce<{ entries: Entry[]; assets: Asset[] }>(
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
function parseEntries(responseObj: any): Array<Entry> {
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
function parseAssets(responseObj: any, protocol: string): Array<Asset> {
	const assets = responseObj.assets || [];
	if (responseObj.includes) {
		// 'includes' is an object where the key = type, and the value = list of items
		for (const [key, items] of Object.entries(responseObj.includes)) {
			if (key === "Asset") {
				const withMediaProtocols = (items as Array<Asset>).map((asset) => {
					if (!asset.fields.file?.url) {
						// no url to update, do nothing
						return asset;
					}

					if (asset.fields.file.url.toString().startsWith("//")) {
						asset.fields.file.url = `${protocol}:${asset.fields.file.url}`;
					}

					return asset;
				});

				assets.push(...withMediaProtocols);
			}
		}
	}
	return assets;
}

async function tryImportContentful() {
	try {
		const contentful = await import("contentful");
		return contentful.createClient;
	} catch (error) {
		throw new Error('Could not find module "contentful". Make sure you have installed it.', {
			cause: error,
		});
	}
}
