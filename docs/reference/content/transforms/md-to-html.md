# mdToHtml content transform

The `mdToHtml` transform converts Markdown content to HTML. It sanitizes HTML in the source and renders either block or inline output.

## Usage

Add it to the content `transforms` list:

```typescript
import { mdToHtml } from '@bluecadet/launchpad/content/transforms/md-to-html'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        mdToHtml({ // [!code highlight:3]
          path: '$.item.description'
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

JSONPath to the Markdown content to convert.

### `simplified`

- **Type:** `boolean`
- **Default:** `false`

When `true`, renders the Markdown as inline HTML, for single-paragraph content.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Data keys to transform. If omitted, all keys are transformed.
