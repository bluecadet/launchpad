import { toHTML } from '@portabletext/to-html';

import { applyTransformToFiles, isBlockContent } from '../../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @param {string[]} [options.keys] Data keys to apply the transform to. If not provided, all keys will be transformed.
 * @returns {import("../../content-plugin-driver.js").ContentPlugin}
 */
export default function sanityToHtml({ path, keys }) {
	return {
		name: 'md-to-html-transform',
		hooks: {
			onContentFetchData(ctx) {
				applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
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
