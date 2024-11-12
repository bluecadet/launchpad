import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles } from "../utils/content-transform-utils.js";
import { dataKeysSchema, type DataKeys } from "../utils/data-store.js";
import markdownItItalicBold from "../utils/markdown-it-italic-bold.js";
import { z } from "zod";

const mdToHtmlSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Enable for single paragraph content, will render inline */
	simplified: z
		.boolean()
		.describe("Enable for single paragraph content, will render inline")
		.default(false),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed */
	keys: dataKeysSchema.optional(),
});

export default function mdToHtml(options: z.input<typeof mdToHtmlSchema>) {
	const { path, simplified, keys } = mdToHtmlSchema.parse(options);

	return defineContentPlugin({
		name: "md-to-html",
		hooks: {
			onContentFetchDone(ctx) {
				return applyTransformToFiles({
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
