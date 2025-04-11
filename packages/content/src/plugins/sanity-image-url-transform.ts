import imageUrlBuilder from "@sanity/image-url";
import type { ImageUrlBuilder } from "@sanity/image-url/lib/types/builder.js";
import type {
	SanityAsset,
	SanityImageObject,
	SanityImageWithAssetStub,
	SanityReference,
} from "@sanity/image-url/lib/types/types.js";
import { z } from "zod";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";

const sanityImageUrlTransformSchema = z.object({
	/** JSONPath to the content to transform. Defaults to all nodes with an `_type` of `image`. */
	path: z
		.string()
		.describe("JSONPath to the content to transform")
		.default('$..*[?(@._type=="image")]'),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
	/** Sanity API Token. Required if dataset is private. */
	apiToken: z.string().describe("Sanity API Token. Required if dataset is private.").optional(),
	/** Sanity Project ID */
	projectId: z.string().describe("Sanity Project ID"),
	/** Sanity Dataset. Defaults to 'production' */
	dataset: z.string().describe("Sanity Dataset").default("production"),
	/** New Property name. Defaults to 'transformedUrl' */
	newProperty: z.string().describe("New Property name").default("transformedUrl"),
	/** Function to build the image URL */
	buildUrl: z
		.function(z.tuple([z.custom<ImageUrlBuilder>()]))
		.returns(z.custom<ImageUrlBuilder>())
		.default((bldr) => bldr)
		.describe("Function to build the image URL"),
});

export default function sanityImageUrlTransform(
	options: z.input<typeof sanityImageUrlTransformSchema>,
) {
	const { path, keys, newProperty, buildUrl, ...rest } = parsePluginConfig(
		"sanityToHtml",
		sanityImageUrlTransformSchema,
		options,
	);

	const builder = imageUrlBuilder(rest);

	return defineContentPlugin({
		name: "sanity-to-html",
		hooks: {
			async onContentFetchDone(ctx) {
				let transformCount = 0;

				ctx.logger.info(
					"Transforming URLs using Sanity Image URL Transform...",
				);

				await applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isValidImageObject(content)) {
							throw new Error(`Invalid image object: ${JSON.stringify(content)}`);
						}

						const transformedUrl = buildUrl(builder.image(content)).url();
						transformCount++;

						return {
							...content,
							[newProperty]: transformedUrl,
						};
					},
				});

				ctx.logger.info(
					`Transformed ${transformCount} URLs.`,
				);
			},
		},
	});
}

function isValidImageObject(value: unknown) {
	return (
		isSanityReference(value) ||
		isSanityAsset(value) ||
		isSanityImageObject(value) ||
		isSanityImageWithAssetStub(value)
	);
}

function isSanityReference(value: unknown): value is SanityReference {
	return typeof value === "object" && value !== null && "_ref" in value;
}

function isSanityAsset(value: unknown): value is SanityAsset {
	return typeof value === "object" && value !== null && "_id" in value;
}

function isSanityImageObject(value: unknown): value is SanityImageObject {
	return (
		typeof value === "object" &&
		value !== null &&
		"asset" in value &&
		(isSanityReference(value.asset) || isSanityAsset(value.asset))
	);
}

function isSanityImageWithAssetStub(value: unknown): value is SanityImageWithAssetStub {
	return (
		typeof value === "object" &&
		value !== null &&
		"asset" in value &&
		typeof value.asset === "object" &&
		value.asset !== null &&
		"url" in value.asset
	);
}
