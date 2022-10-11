import toMarkdown from '@sanity/block-content-to-markdown';

import ContentTransform from './content-transform.js';

class SanityToMarkdownTransform extends ContentTransform {
  constructor() {
    super();
    this.transform = this.transform.bind(this);
  }
  
  transform(content) {
    if (content._type !== 'block' || !content.children) {
      throw new Error(`Content is not a valid Sanity text block (must contain a "_type": "block" property): ${content}`);
    }
    return toMarkdown(content);
  }
}

export default SanityToMarkdownTransform;
