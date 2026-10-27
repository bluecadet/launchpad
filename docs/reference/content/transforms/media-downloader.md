# mediaDownloader content transform

The `mediaDownloader` transform downloads media URLs referenced in content. It stages files in the owning source's download directory, and Launchpad publishes them after a successful content run.

## Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms';

export default defineConfig({
  plugins: [
    content({
      sources: [ /* ... */ ],
      transforms: [mediaDownloader({ maxConcurrent: 4 })],
    }),
  ],
});
```

## Cache behavior

The downloader uses the [shared artifact cache](../artifact-cache.md#downloaded-media). While an explicit HTTP freshness lifetime is valid, it reuses verified, previously published files without a request. Otherwise it contacts the server every run, sending a conditional GET with the server's `ETag` or `Last-Modified` when available.

The downloader uses no freshness heuristic, local-mtime HEAD check, or remote-size comparison. `no-store`, `no-cache`, and `Vary` constrain reuse. A missing or corrupt local file needs a full download, even if cached policy metadata is fresh. Only the applicable HTTP policy can allow stale reuse after an error.

Filenames and URL-to-path mapping are unchanged. Launchpad rejects different download or artifact identities that target the same path, so give each its own destination.

## Options

### `keys`

- **Type:** `string[]`
- **Default:** `undefined`

Data keys to search for media URLs. If omitted, all keys are searched.

### `mediaPattern`

- **Type:** `RegExp`
- **Default:** `/https?.*\.(jpe?g|png|webp|avi|mov|mp4|mpg|mpeg|webm)(\?.*)?$/i`

Pattern used to find media URLs.

### `matchPath`

- **Type:** `string | string[]`
- **Default:** `undefined`

One or more JSONPath-Plus expressions that find URLs. Overrides `mediaPattern`.

### `maxConcurrent`

- **Type:** Positive integer
- **Default:** `4`

Maximum number of simultaneous downloads.

### `ignoreCache`

- **Type:** `boolean`
- **Default:** `false`

When `true`, always downloads instead of reusing a fresh file or sending cached validators. Filenames and other recipes' artifact metadata are unaffected.

### `forceClearTempFiles`

- **Type:** `boolean`
- **Default:** `false`

Clears this transform's temporary files before downloading, without recreating the directory. Downloads write directly into the run's staged download tree; when this option is `false`, the downloader neither creates nor cleans a separate transform temp tree. It does **not** invalidate HTTP cache records or delete published downloads. To invalidate metadata, use [cache-only clearing](../artifact-cache.md#clearing).

### `transformLocalPath`

- **Type:** `(localPath: string) => string`
- **Default:** `undefined`

Rewrites the destination path derived from each URL. Return a path relative to, and inside, the source's download directory. Each remote resource needs its own destination.

### `maxTimeout`

- **Type:** Positive integer
- **Default:** `10000`

HTTP request timeout in milliseconds.

### `abortOnError`

- **Type:** `boolean`
- **Default:** `true`

When `true`, a download error fails the transform. When `false`, errors are logged and the transform continues, so failed media can be missing from published output. Stale cache reuse still follows HTTP policy.

### `updatePaths`

- **Type:** `boolean`
- **Default:** `true`

Replaces media URLs in content with local paths relative to the source's download directory. Keep this enabled when a later Sharp transform reads the downloaded images.

HTTP policy controls freshness and validation, replacing the removed validator and content-length toggles. This transform requires Node.js 24.x or 26 and later (`^24 || >=26`).
