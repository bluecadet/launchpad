import { toHTML } from '@portabletext/to-html';

import ContentTransform from './content-transform.js';

class SanityToHtmlTransform extends ContentTransform {
  constructor() {
    super();
    this.transform = this.transform.bind(this);
  }
  
  transform(content) {
    if (content._type !== 'block' || !content.children) {
      throw new Error(`Content is not a valid Sanity text block: ${content}`);
    }
    return toHTML(content);
  }
}

export default SanityToHtmlTransform;
