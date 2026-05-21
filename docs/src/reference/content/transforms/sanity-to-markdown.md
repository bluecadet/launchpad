# sanityToMarkdown Content Plugin

The `sanityToMarkdown` plugin is used to transform Sanity.io Portable Text content into Markdown. It converts block content from Sanity's structured format into standard Markdown syntax.

## Usage

To use the `sanityToMarkdown` plugin, include it in the list of content plugins in your configuration:

```typescript
import { sanityToMarkdown } from '@bluecadet/launchpad/content/transforms/sanity-to-markdown'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        sanityToMarkdown({ // [!code highlight:3]
          path: '$.item.content'
        })
      ]
    })
  ]  
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
