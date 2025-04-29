import { z } from "zod";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";

const sanityToMdSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
});

function tryImportBlockToMd() {
	try {
		// @ts-expect-error - no types from this lib
		return import("@sanity/block-content-to-markdown");
	} catch (e) {
		throw new Error(
			'Could not find peer dependency "@sanity/block-content-to-markdown". Make sure you have installed it.',
			{ cause: e },
		);
	}
}

export default function sanityToMd(options: z.input<typeof sanityToMdSchema>) {
	const { path, keys } = parsePluginConfig("sanityToMd", sanityToMdSchema, options);

	return defineContentPlugin({
		name: "sanity-to-markdown",
		hooks: {
			async onContentFetchDone(ctx) {
				const {default: toMarkdown} = await tryImportBlockToMd();

				let transformCount = 0;
				ctx.logger.info("Transforming sanity blocks to markdown...");

				await applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isBlockContent(content)) {
							throw new Error(`Content is not a valid Sanity text block: ${content}`);
						}

						transformCount++;

						return toMarkdown(content);
					},
				});

				ctx.logger.info(`Transformed ${transformCount} Sanity blocks to markdown.`);
			},
		},
	});
}
