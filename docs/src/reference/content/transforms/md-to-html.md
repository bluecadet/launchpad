# mdToHtml Content Transform

The `mdToHtml` transform is used to transform Markdown content into HTML. It supports both block and inline rendering, with optional sanitization and custom Markdown syntax extensions.

## Usage

To use the `mdToHtml` transform, include it in the list of content transforms in your configuration:

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

Specifies the JSONPath to the content that needs to be transformed from Markdown to HTML.

### `simplified`

- **Type:** `boolean`
- **Default:** `false`

When set to `true`, the plugin will render the Markdown content as inline HTML, suitable for single paragraph content.

### `keys`

- **Type:** `DataKeys`
- **Default:** `undefined`

Specifies the data keys to which the transformation should be applied. If not provided, the transformation will be applied to all keys.
