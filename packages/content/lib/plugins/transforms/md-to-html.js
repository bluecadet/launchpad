import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

import markdownItItalicBold from '../../utils/markdown-it-italic-bold.js';
import { applyTransformToFiles } from '../../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @param {boolean} [options.simplified] enable for single paragraph content, will render inline
 * @param {import('../../utils/content-transform-utils.js').DataKeys} [options.keys] Data keys to apply the transform to. If not provided, all keys will be transformed.
 * @returns {import("../../content-plugin-driver.js").ContentPlugin}
 */
export default function mdToHtml({ path, simplified = false, keys }) {
	return {
		name: 'md-to-html-transform',
		hooks: {
			onContentFetchDone(ctx) {
				applyTransformToFiles({
					dataStore: ctx.data,
					path,
					keys,
					logger: ctx.logger,
					transformFn: (content) => {
						if (typeof content !== 'string') {
							throw new Error('Can\'t convert non-string content to html.');
						}

						const sanitizedStr = sanitizeHtml(content);
						const md = new MarkdownIt();

						if (simplified) {
							md.use(markdownItItalicBold);
							return md.renderInline(sanitizedStr);
						}

						return md.render(sanitizedStr);
					}
				});
			}
		}
	};
}
