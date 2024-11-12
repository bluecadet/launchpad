// @ts-expect-error - no types from this lib
import toMarkdown from "@sanity/block-content-to-markdown";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { z } from "zod";

const sanityToMdSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
});

export default function sanityToMd(options: z.input<typeof sanityToMdSchema>) {
	const { path, keys } = sanityToMdSchema.parse(options);

	return defineContentPlugin({
		name: "sanity-to-markdown",
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

						return toMarkdown(content);
					},
				});
			},
		},
	});
}
