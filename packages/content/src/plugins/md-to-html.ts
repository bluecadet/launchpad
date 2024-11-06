import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles } from "../utils/content-transform-utils.js";
import type { DataKeys } from "../utils/data-store.js";
import markdownItItalicBold from "../utils/markdown-it-italic-bold.js";

type MdToHtmlOptions = {
	/** JSONPath to the content to transform */
	path: string;
	/** Enable for single paragraph content, will render inline */
	simplified?: boolean;
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys?: DataKeys;
};

export default function mdToHtml({ path, simplified = false, keys }: MdToHtmlOptions) {
	return defineContentPlugin({
		name: "md-to-html",
		hooks: {
			onContentFetchDone(ctx) {
				applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (typeof content !== "string") {
							throw new Error("Can't convert non-string content to html.");
						}

						const sanitizedStr = sanitizeHtml(content);
						const md = new MarkdownIt();

						if (simplified) {
							md.use(markdownItItalicBold);
							return md.renderInline(sanitizedStr);
						}

						return md.render(sanitizedStr);
					},
				});
			},
		},
	});
}
