# sanityToPlain content transform

The `sanityToPlain` transform converts Sanity Portable Text to plain text, stripping all markup and formatting.

## Usage

Add it to the content `transforms` list:

```typescript
import { sanityToPlain } from '@bluecadet/launchpad/content/transforms/sanity-to-plain'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        sanityToPlain({ // [!code highlight:3]
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
