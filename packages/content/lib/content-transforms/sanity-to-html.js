import { toHTML } from '@portabletext/to-html';

import ContentTransform from './content-transform.js';

class SanityToHtmlTransform extends ContentTransform {
	constructor() {
		super();
		this.transform = this.transform.bind(this);
	}
	
	/**
	 * @param {unknown} content
	 */
	transform(content) {
		if (!ContentTransform.isBlockContent(content)) {
			throw new Error(`Content is not a valid Sanity text block: ${content}`);
		}
		
		return toHTML(content);
	}
}

export default SanityToHtmlTransform;
