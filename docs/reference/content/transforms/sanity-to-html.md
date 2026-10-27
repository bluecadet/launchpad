# sanityToHtml content transform

The `sanityToHtml` transform converts Sanity Portable Text block content to HTML.

## Usage

Add it to the content `transforms` list:

```typescript
import { sanityToHtml } from '@bluecadet/launchpad/content/transforms/sanity-to-html'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        sanityToHtml({ // [!code highlight:3]
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
