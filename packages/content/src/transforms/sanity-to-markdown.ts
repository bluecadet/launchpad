import { z } from "zod";
import { defineContentTransform } from "../content-transform.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { parseTransformConfig } from "./content-transform-helpers.js";

const sanityToMdSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
});

function tryImportBlockToMd() {
	try {
		return import("@portabletext/markdown");
	} catch (e) {
		throw new Error(
			'Could not find peer dependency "@portabletext/markdown". Make sure you have installed it.',
			{ cause: e },
		);
	}
}

export default function sanityToMd(options: z.input<typeof sanityToMdSchema>) {
	const { path, keys } = parseTransformConfig("sanityToMd", sanityToMdSchema, options);

	return defineContentTransform({
		name: "sanity-to-markdown",
		async apply(ctx) {
			const { portableTextToMarkdown } = await tryImportBlockToMd();

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

					return portableTextToMarkdown([content]);
				},
			});

			ctx.logger.info(`Transformed ${transformCount} Sanity blocks to markdown.`);
		},
	});
}
