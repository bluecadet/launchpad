// @ts-expect-error - no types from this lib
import toMarkdown from '@sanity/block-content-to-markdown';
import { applyTransformToFiles, isBlockContent } from '../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @returns {import("../content-plugin.js").ContentPlugin}
 */
export default function sanityToMd({ path }) {
	return {
		name: 'md-to-html-transform',
		hooks: {
			onContentFetchData(ctx, { dataFiles }) {
				applyTransformToFiles({
					dataFiles,
					path,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isBlockContent(content)) {
							throw new Error(`Content is not a valid Sanity text block: ${content}`);
						}
		
						return toMarkdown(content);
					}
				});
			}
		}
	};
}
