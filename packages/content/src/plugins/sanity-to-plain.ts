import { z } from "zod";
import { defineContentPlugin } from "../content-plugin-driver.js";
import { applyTransformToFiles, isBlockContent } from "../utils/content-transform-utils.js";
import { dataKeysSchema } from "../utils/data-store.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";

const sanityToPlainSchema = z.object({
	/** JSONPath to the content to transform */
	path: z.string().describe("JSONPath to the content to transform"),
	/** Data keys to apply the transform to. If not provided, all keys will be transformed. */
	keys: dataKeysSchema.optional(),
});

export default function sanityToPlain(options: z.input<typeof sanityToPlainSchema>) {
	const { path, keys } = parsePluginConfig("sanityToPlain", sanityToPlainSchema, options);

	return defineContentPlugin({
		name: "sanity-to-plain",
		hooks: {
			async onContentFetchDone(ctx) {
				let transformCount = 0;
				ctx.logger.info("Transforming sanity blocks to plain text...");

				await applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isBlockWithChildren(content)) {
							throw new Error(`Content is not a valid Sanity text block: ${content}`);
						}

						transformCount++;

						return content.children.map((child) => child.text).join("");
					},
				});

				ctx.logger.info(`Transformed ${transformCount} Sanity blocks to plain text.`);
			},
		},
	});
}

function isBlockWithChildren(
	content: unknown,
): content is { _type: "block"; children: { text: string }[] } {
	// check if object
	if (!isBlockContent(content)) {
		return false;
	}

	// check if children
	if (!("children" in content) || !Array.isArray(content.children)) {
		return false;
	}

	// check if children are objects with 'text' property
	if (!content.children.every((child) => typeof child === "object" && "text" in child)) {
		return false;
	}

	return true;
}
