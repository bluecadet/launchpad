# Sharp content transform

The `sharp` transform processes downloaded images with the [Sharp](https://sharp.pixelplumbing.com/) library, for example to resize them or convert their format.

## Usage

Add it to the content `transforms` list after `mediaDownloader`:

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

Sharp uses the [shared artifact cache](../artifact-cache.md) automatically. Its identity covers the resolved Sharp recipe and options, input content, supported file and buffer dependencies, output paths, and the `sharp.versions` engine fingerprint. Supported recipes need no user-supplied version or cache key.

A change to input bytes, resize, format, or compression options, supported overlay dependencies, or engine versions invalidates reuse. Previously published outputs must also pass local file verification before Launchpad copies them into staging. The transform analyzes the resolved recipe once per application, and cache hits skip building per-image pipelines.

Each image in a batch reads its original input and explicit file dependencies, even when another image's output replaces one of those files. Sharp snapshots overlapping inputs before generation or cache restoration starts. Snapshot paths are not part of the cache identity, and filenames stay the same.

The transform caches only recipes whose options and dependencies it can reliably resolve. Unsupported loaders, text, font, or external-resource dependencies, unknown options, nondeterministic operations, and unaudited Sharp versions run uncached with a diagnostic. Setting `cacheKey` does not make an unsupported recipe cacheable. A recipe whose input and output share a path also runs uncached; use distinct paths for reusable results.

Output naming is unchanged. Different cached identities that claim the same output path raise an error instead of overwriting each other. Give competing transforms distinct destinations, or avoid targeting one image with conflicting recipes.

## Options

### `buildTransform`

- **Type:** `(transform: Sharp) => Sharp`
- **Required**

Receives a Sharp instance and returns it with the image transformations to apply.

### `mediaPattern`

- **Type:** `RegExp`
- **Default:** `/\.(jpe?g|png|webp|tiff|gif|svg)$/i`

Pattern that matches image files to transform.

### `matchPath`

- **Type:** `string`
- **Optional**

JSONPath-Plus path that matches images to transform. Overrides `mediaPattern`.

### `updateURLs`

- **Type:** `boolean`
- **Default:** `false`

When `true`, points image URLs in the content at the transformed images. Leave it `false` when several transforms target the same image.

### `keys`

- **Type:** `string[]`
- **Optional**

Data keys to search for images. If omitted, all keys are searched.

### `cacheKey`

- **Type:** `string`
- **Optional**

Extra invalidation token for application-specific changes, added to the automatic recipe, dependency, input, and engine fingerprints. For example, change `cacheKey: 'gallery-policy-2'` when an application-level processing policy changes but the resolved recipe does not. Most transforms should omit it.

### `concurrency`

- **Type:** `number`
- **Default:** `4`

Number of images to transform at once.
