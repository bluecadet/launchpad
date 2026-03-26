# sanityImageUrlTransform Content Plugin

The `sanityImageUrlTransform` plugin transforms Sanity image references into usable URLs. It can apply image transformations like resizing, cropping, and format conversion using Sanity's image URL builder.

## Usage

To use the `sanityImageUrlTransform` plugin, include it in your configuration before your `mediaDownloader` plugin:

```typescript
import { sanityImageUrlTransform } from '@bluecadet/launchpad-content/transforms/sanity-image-url-transform'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        sanityImageUrlTransform({ // [!code highlight:7]
          projectId: 'your-project-id',
          dataset: 'production',
          buildUrl: (builder) => builder
            .width(800)
            .format('webp')
        }),
        mediaDownloader({
          //...
        })
      ]
    })
  ]  
});
```

## Options

### `projectId`

- **Type:** `string`
- **Required**

Your Sanity project ID.

### `dataset`

- **Type:** `string`
- **Default:** `"production"`

The Sanity dataset to use.

### `apiToken`

- **Type:** `string`
- **Optional**

Sanity API token, required if accessing a private dataset.

### `path`

- **Type:** `string`
- **Default:** `'$..*[?(@._type=="image")]'`

JSONPath to the content to transform. By default, matches all nodes with `_type` of "image".

### `buildUrl`

- **Type:** `(builder: ImageUrlBuilder) => ImageUrlBuilder`
- **Default:** `builder => builder`

Function to configure image transformations using Sanity's image URL builder.

### `newProperty`

- **Type:** `string`
- **Default:** `"transformedUrl"`

The property name where the transformed URL will be stored.

### `keys`

- **Type:** `string[]`
- **Optional**

Specific data keys to transform. If not provided, transforms all keys.
