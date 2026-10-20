import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import type {
	ImageUrlBuilder,
	SanityAsset,
	SanityImageObject,
	SanityImageWithAssetStub,
	SanityReference,
} from "@sanity/image-url";
import { z } from "zod";
import { defineContentTransform } from "../content-transform.js";
import { applyTransformToFiles } from "../utils/content-transform-utils.js";
import { type DataKeys, dataKeysSchema } from "../utils/data-store.js";
import { parseTransformConfig } from "./content-transform-helpers.js";

/** Options for the `sanityImageUrlTransform` transform. */
export interface SanityImageUrlTransformOptions {
	/** JSONPath to the content to transform. Defaults to all nodes with an `_type` of `image`. */
	path?: string;
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys?: DataKeys;
	/** Sanity API Token. Required if dataset is private. */
	apiToken?: string;
	/** Sanity Project ID */
	projectId: string;
	/** Sanity Dataset. Defaults to `"production"`. */
	dataset?: string;
	/** New Property name. Defaults to `"transformedUrl"`. */
	newProperty?: string;
	/** Function to build the image URL. Defaults to returning the builder unchanged. */
	buildUrl?: (builder: ImageUrlBuilder) => ImageUrlBuilder;
}

const sanityImageUrlTransformSchema = configSchema<SanityImageUrlTransformOptions>()(
	z.object({
		path: z
			.string()
			.describe("JSONPath to the content to transform")
			.default('$..*[?(@._type=="image")]'),
		keys: dataKeysSchema.optional(),
		apiToken: z.string().describe("Sanity API Token. Required if dataset is private.").optional(),
		projectId: z.string().describe("Sanity Project ID"),
		dataset: z.string().describe("Sanity Dataset").default("production"),
		newProperty: z.string().describe("New Property name").default("transformedUrl"),
		buildUrl: z
			.function({
				input: [z.custom<ImageUrlBuilder>()],
				output: z.custom<ImageUrlBuilder>(),
			})
			.default((bldr) => bldr)
			.describe("Function to build the image URL"),
	}),
);

function tryImportSanityImage() {
	try {
		return import("@sanity/image-url");
	} catch (e) {
		throw new Error(
			'Could not find peer dependency "@sanity/image-url". Make sure you have installed it.',
			{ cause: e },
		);
	}
}

export function sanityImageUrlTransform(options: SanityImageUrlTransformOptions) {
	const { path, keys, newProperty, buildUrl, ...rest } = parseTransformConfig(
		"sanityToHtml",
		sanityImageUrlTransformSchema,
		options,
	);

	return defineContentTransform({
		name: "sanity-to-html",
		async apply(ctx) {
			const { default: imageUrlBuilder } = await tryImportSanityImage();

			const builder = imageUrlBuilder(rest);

			let transformCount = 0;

			ctx.logger.info("Transforming URLs using Sanity Image URL Transform...");

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

			ctx.logger.info(`Transformed ${transformCount} URLs.`);
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
