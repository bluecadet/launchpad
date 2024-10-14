import { applyTransformToFiles, isBlockContent } from '../utils/content-transform-utils.js';

/**
 * @param {object} options
 * @param {string} options.path JSONPath to the content to transform
 * @returns {import("../content-plugin.js").ContentPlugin}
 */
export default function sanityToPlain({ path }) {
	return {
		name: 'md-to-html-transform',
		hooks: {
			onContentFetchData(ctx, { dataFiles }) {
				applyTransformToFiles({
					dataFiles,
					path,
					logger: ctx.logger,
					transformFn: (content) => {
						if (!isBlockWithChildren(content)) {
							throw new Error(`Content is not a valid Sanity text block: ${content}`);
						}
		
						return content.children.map(child => child.text).join('');
					}
				});
			}
		}
	};
}

/**
 * @param {unknown} content
	 * @returns {content is { _type: "block", children: { text: string }[]}}
 */
function isBlockWithChildren(content) {
	// check if object
	if (!isBlockContent(content)) {
		return false;
	}

	// check if children
	if (!('children' in content) || !Array.isArray(content.children)) {
		return false;
	}

	// check if children are objects with 'text' property
	if (!content.children.every(child => typeof child === 'object' && 'text' in child)) {
		return false;
	}

	return true;
}
