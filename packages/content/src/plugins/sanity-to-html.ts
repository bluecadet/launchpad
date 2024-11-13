import { toHTML } from "@portabletext/to-html";

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

export default function sanityToHtml(options: z.input<typeof sanityToHtmlSchema>) {
	const { path, keys } = parsePluginConfig("sanityToHtml", sanityToHtmlSchema, options);

	return defineContentPlugin({
		name: "sanity-to-html",
		hooks: {
			onContentFetchDone(ctx) {
				return applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isBlockContent(content)) {
							throw new Error(`Content is not a valid Sanity text block: ${content}`);
						}

						return toHTML(content);
					},
				});
			},
		},
	});
}
