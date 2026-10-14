# Sharp Content Transform

The `sharp` transform is used to transform downloaded images using the [Sharp](https://sharp.pixelplumbing.com/) image processing library. It can resize, format convert, and apply various transformations to your images.

## Usage

To use the `sharp` transform, include it in the list of content transforms after the mediaDownloader in your configuration:

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader, sharp } from '@bluecadet/launchpad/content/transforms'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        mediaDownloader({}),
        sharp({ // [!code highlight:6]
          buildTransform: (transform) => transform
            .resize(800, 600)
            .jpeg({ quality: 80 }),
          updateURLs: true
        })
      ]
    })
  ]
});
```

## Cache behavior

Sharp uses the [shared artifact cache](../artifact-cache.md) automatically. Its identity includes the resolved Sharp recipe/options, input content, supported file and buffer dependencies, output paths, and the `sharp.versions` engine fingerprint. Ordinary supported recipes do not need a user-supplied version or cache key.

Changed input bytes, resize/format/compression options, supported overlay dependencies, or engine versions invalidate reuse. Previously published outputs must also pass local file verification before they are copied into the current staging tree. The resolved recipe is analyzed once per transform application; cache hits do not construct per-image execution pipelines.

Every image in a batch reads its original input and explicit file dependencies, even when another image's output replaces one of those files. Sharp snapshots overlapping inputs before generation or cache restoration starts. These temporary snapshot paths are not part of the cache identity, and filenames remain unchanged.

The adapter only caches recipes whose options and dependencies it can reliably resolve. Unsupported loaders, text/font or external-resource dependencies, unknown options, nondeterministic operations, and unaudited Sharp versions run uncached with a diagnostic. An optional `cacheKey` does not make an unsupported recipe cacheable. Inputs and outputs at the same path also run uncached; use distinct paths for reusable results.

Output naming is unchanged. Different cached identities claiming the same output path are an error, not an overwrite. Give competing transforms distinct destinations or avoid targeting the same image with conflicting recipes.

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

### `cacheKey`

- **Type:** `string`
- **Optional**

An additional invalidation token for application-specific changes. It supplements automatic recipe, dependency, input, and engine fingerprinting; it never replaces them. For example, change `cacheKey: 'gallery-policy-2'` when an application-level processing policy changes without otherwise changing the resolved recipe. Most transforms should omit it.

### `concurrency`

- **Type:** `number`
- **Default:** `4`

The number of images to transform concurrently.
