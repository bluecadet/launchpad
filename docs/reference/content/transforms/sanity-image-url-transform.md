# sanityImageUrlTransform content transform

The `sanityImageUrlTransform` transform turns Sanity image references into URLs. It can resize, crop, and convert images with Sanity's image URL builder.

## Usage

Add it to the content `transforms` list before `mediaDownloader`:

```typescript
import { sanityImageUrlTransform } from '@bluecadet/launchpad/content/transforms/sanity-image-url-transform'; // [!code highlight]

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

Sanity API token. Required for private datasets.

### `path`

- **Type:** `string`
- **Default:** `'$..*[?(@._type=="image")]'`

JSONPath to the content to transform. The default matches every node whose `_type` is `"image"`.

### `buildUrl`

- **Type:** `(builder: ImageUrlBuilder) => ImageUrlBuilder`
- **Default:** `builder => builder`

Configures image transformations on Sanity's image URL builder.

### `newProperty`

- **Type:** `string`
- **Default:** `"transformedUrl"`

Property that stores the transformed URL.

### `keys`

- **Type:** `string[]`
- **Optional**

Data keys to transform. If omitted, all keys are transformed.
