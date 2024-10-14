import { toHTML } from '@portabletext/to-html';

import { applyTransformToFiles, isBlockContent } from '../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @returns {import("../content-plugin-driver.js").ContentPlugin}
 */
export default function sanityToHtml({ path }) {
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
		
						return toHTML(content);
					}
				});
			}
		}
	};
}
