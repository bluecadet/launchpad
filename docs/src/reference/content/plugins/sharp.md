# Sharp Content Plugin

The `sharp` plugin is used to transform downloaded images using the [Sharp](https://sharp.pixelplumbing.com/) image processing library. It can resize, format convert, and apply various transformations to your images.

## Usage

To use the `sharp` plugin, include it in the list of content plugins after the mediaDownloader in your configuration:

```typescript{1,7-12}
import { sharp } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    plugins: [
      mediaDownloader({}),
      sharp({
        buildTransform: (transform) => transform
          .resize(800, 600)
          .jpeg({ quality: 80 }),
        updateURLs: true
      })
    ]
  }  
});
```

## Options

### `buildTransform`

- **Type:** `(transform: Sharp) => Sharp`
- **Required**

A function that takes a Sharp instance and returns a transformed Sharp instance. This is where you define the image transformations to apply.

### `mediaPattern`

- **Type:** `RegExp`
- **Default:** `/\.(jpe?g|png|webp|tiff|gif|svg)$/i`

Regex pattern to match image files that should be transformed.

### `matchPath`

- **Type:** `string`
- **Optional**

JSONPath-Plus compatible path to match images to transform. Overrides `mediaPattern` if provided.

### `updateURLs`

- **Type:** `boolean`
- **Default:** `false`

When true, updates URLs in the content to point to the transformed images. Note: if you have multiple transforms targeting the same image, you should keep this as false.

### `keys`

- **Type:** `string[]`
- **Optional**

Specifies which data keys to transform. If not provided, all keys will be searched for images.

### `concurrency`

- **Type:** `number`
- **Default:** `4`

The number of images to transform concurrently.
