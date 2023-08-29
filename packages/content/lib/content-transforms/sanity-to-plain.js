import ContentTransform from './content-transform.js';

class SanityToPlainTransform extends ContentTransform {
	constructor() {
		super();
		this.transform = this.transform.bind(this);
	}
	
	/**
	 * @param {unknown} content
	 */
	transform(content) {
		if (!SanityToPlainTransform.isBlockWithChildren(content)) {
			throw new Error(`Content is not a valid Sanity text block: ${content}`);
		}
		return content.children.map(child => child.text).join('');
	}

	/**
	 * @param {unknown} content
	 * @returns {content is { _type: "block", children: { text: string }[]}}
	 */
	static isBlockWithChildren(content) {
		// check if object
		if (!ContentTransform.isBlockContent(content)) {
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
}

export default SanityToPlainTransform;
