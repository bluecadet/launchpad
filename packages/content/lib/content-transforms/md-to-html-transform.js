import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

import markdownItItalicBold from '../utils/markdown-it-italic-bold.js';
import ContentTransform from './content-transform.js';

class MdToHtmlTransform extends ContentTransform {
	constructor(simplified = false) {
    super();
		this.simplified = simplified;
	}
	
	transform(content) {
		if (typeof content !== 'string' && !(content instanceof String)) {
      throw new Error(`Can't convert a non-string content to html.`);
    }

    const sanitizedStr = sanitizeHtml(content);
    const md = new MarkdownIt();

    if (this.simplified) {
      md.use(markdownItItalicBold);
      return md.renderInline(sanitizedStr);
    } else {
      return md.render(sanitizedStr);
    }
	}
}

export default MdToHtmlTransform;
