import { toHTML } from "@portabletext/to-html";

import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import type { DataKeys } from "../utils/data-store.js";

type SanityToHtmlOptions = {
	/** JSONPath to the content to transform */
	path: string;
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys?: DataKeys;
};

export default function sanityToHtml({ path, keys }: SanityToHtmlOptions) {
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
