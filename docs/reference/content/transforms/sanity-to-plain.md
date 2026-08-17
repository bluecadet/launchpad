# sanityToPlain Content Transform

The `sanityToPlain` transform is used to transform Sanity.io Portable Text content into plain text. It extracts text content from Sanity's structured format, removing any markup or formatting.

## Usage

To use the `sanityToPlain` transform, include it in the list of content transforms in your configuration:

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

Specifies the JSONPath to the Sanity Portable Text content that needs to be transformed to plain text.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
