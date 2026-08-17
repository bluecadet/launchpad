# sanityToHtml Content Transform

The `sanityToHtml` transform is used to transform Sanity.io Portable Text content into HTML. It converts block content from Sanity's structured format into standard HTML markup.

## Usage

To use the `sanityToHtml` transform, include it in the list of content transforms in your configuration:

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

Specifies the JSONPath to the Sanity Portable Text content that needs to be transformed to HTML.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
