# sanityToHtml Content Plugin

The `sanityToHtml` plugin is used to transform Sanity.io Portable Text content into HTML. It converts block content from Sanity's structured format into standard HTML markup.

## Usage

To use the `sanityToHtml` plugin, include it in the list of content plugins in your configuration:

```typescript{1,6-8}
import { sanityToHtml } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    plugins: [
      sanityToHtml({
        path: '$.item.content'
      })
    ]
  }  
});
```

## Options

### `path`

- **Type:** `string`
- **Required**

Specifies the JSONPath to the Sanity Portable Text content that needs to be transformed to HTML.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
