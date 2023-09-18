class ContentTransform {
	/**
	 * @param {string} content
	 * @returns {string}
	 */
	transform(content) {
		return content;
	}

	/**
	 * @param {unknown} content
	 * @returns {content is { _type: "block" }}
	 */
	static isBlockContent(content) {
		// check if object
		if (typeof content !== 'object' || content === null) {
			return false;
		}

		// check if block
		if (!('_type' in content) || content._type !== 'block') {
			return false;
		}

		return true;
	}
}

export default ContentTransform;
