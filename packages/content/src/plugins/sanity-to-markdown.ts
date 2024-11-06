// @ts-expect-error - no types from this lib
import toMarkdown from "@sanity/block-content-to-markdown";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import type { DataKeys } from "../utils/data-store.js";

type SanityToMarkdownOptions = {
	/** JSONPath to the content to transform */
	path: string;
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys?: DataKeys;
};

export default function sanityToMd({ path, keys }: SanityToMarkdownOptions) {
	return defineContentPlugin({
		name: "sanity-to-markdown",
		hooks: {
			onContentFetchDone(ctx) {
				applyTransformToFiles({
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
