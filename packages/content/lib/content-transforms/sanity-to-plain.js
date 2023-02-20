import ContentTransform from './content-transform.js';

class SanityToPlainTransform extends ContentTransform {
	constructor() {
		super();
		this.transform = this.transform.bind(this);
	}
	
	transform(content) {
		if (content._type !== 'block' || !content.children) {
			throw new Error(`Content is not a valid Sanity text block: ${content}`);
		}
		return content.children.map(child => child.text).join('');
	}
}

export default SanityToPlainTransform;
