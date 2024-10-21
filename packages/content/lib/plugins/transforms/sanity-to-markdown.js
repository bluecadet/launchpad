// @ts-expect-error - no types from this lib
import toMarkdown from '@sanity/block-content-to-markdown';
import { applyTransformToFiles, isBlockContent } from '../../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @param {import('../../utils/content-transform-utils.js').DataKeys} [options.keys] Data keys to apply the transform to. If not provided, all keys will be transformed.
 * @returns {import("../../content-plugin-driver.js").ContentPlugin}
 */
export default function sanityToMd({ path, keys }) {
	return {
		name: 'md-to-html-transform',
		hooks: {
			onContentFetchDataDone(ctx) {
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
					}
				});
			}
		}
	};
}