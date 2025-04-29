import { z } from "zod";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";

const sanityToHtmlSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
});

function tryImportPortableText() {
	try {
		return import("@portabletext/to-html");
	} catch (e) {
		throw new Error(
			'Could not find peer dependency "@portabletext/to-html". Make sure you have installed it.',
			{ cause: e },
		);
	}
}

export default function sanityToHtml(options: z.input<typeof sanityToHtmlSchema>) {
	const { path, keys } = parsePluginConfig("sanityToHtml", sanityToHtmlSchema, options);

	return defineContentPlugin({
		name: "sanity-to-html",
		hooks: {
			async onContentFetchDone(ctx) {
				const { toHTML } = await tryImportPortableText();

				let transformCount = 0;
				ctx.logger.info("Transforming sanity blocks to HTML...");

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

						return toHTML(content);
					},
				});

				ctx.logger.info(`Transformed ${transformCount} Sanity blocks to HTML.`);
			},
		},
	});
}
