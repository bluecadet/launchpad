import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

import { z } from "zod";
import { defineContentTransform } from "../content-transform.js";
import { applyTransformToFiles } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import markdownItItalicBold from "../utils/markdown-it-italic-bold.js";
import { parseTransformConfig } from "./content-transform-helpers.js";

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
	const { path, keys, simplified } = parseTransformConfig("mdToHtml", mdToHtmlSchema, options);

	return defineContentTransform({
		name: "md-to-html",
		async apply(ctx) {
			let transformCount = 0;
			ctx.logger.info("Transforming Markdown strings to HTML...");

			await applyTransformToFiles({
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

					transformCount++;

					return md.render(sanitizedStr);
				},
			});

			ctx.logger.info(`Transformed ${transformCount} Markdown strings.`);
		},
	});
}
