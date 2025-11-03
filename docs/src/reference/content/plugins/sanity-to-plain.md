# sanityToPlain Content Plugin

The `sanityToPlain` plugin is used to transform Sanity.io Portable Text content into plain text. It extracts text content from Sanity's structured format, removing any markup or formatting.

## Usage

To use the `sanityToPlain` plugin, include it in the list of content plugins in your configuration:

```typescript{1,6-8}
import { sanityToPlain } from '@bluecadet/launchpad-content/plugins/sanity-to-plain';

export default defineConfig({
  content: {
    plugins: [
      sanityToPlain({
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

Specifies the JSONPath to the Sanity Portable Text content that needs to be transformed to plain text.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
