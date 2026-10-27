# sanityToMarkdown content transform

The `sanityToMarkdown` transform converts Sanity Portable Text block content to Markdown.

## Usage

Add it to the content `transforms` list:

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

JSONPath to the Sanity Portable Text content to convert.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Data keys to transform. If omitted, all keys are transformed.
