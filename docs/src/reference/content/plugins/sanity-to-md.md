# sanityToMd Content Plugin

The `sanityToMd` plugin is used to transform Sanity.io Portable Text content into Markdown. It converts block content from Sanity's structured format into standard Markdown syntax.

## Usage

To use the `sanityToMd` plugin, include it in the list of content plugins in your configuration:

```typescript{1,6-8}
import { sanityToMd } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    plugins: [
      sanityToMd({
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

Specifies the JSONPath to the Sanity Portable Text content that needs to be transformed to Markdown.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
