import { toHTML } from '@portabletext/to-html';

import { applyTransformToFiles, isBlockContent } from '../utils/content-transform-utils.js';
import { defineContentPlugin } from '../content-plugin-driver.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @param {import('../utils/data-store.js').DataKeys} [options.keys] Data keys to apply the transform to. If not provided, all keys will be transformed.
 */
export default function sanityToHtml({ path, keys }) {
	return defineContentPlugin({
		name: 'sanity-to-html',
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

						return toHTML(content);
					}
				});
			}
		}
	});
}
