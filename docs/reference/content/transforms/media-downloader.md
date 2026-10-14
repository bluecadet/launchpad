# mediaDownloader Content Transform

The `mediaDownloader` transform downloads media URLs referenced in content. Files are staged in the owning source's download directory and published after a successful content run.

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

The downloader uses the [shared artifact cache](../artifact-cache.md#downloaded-media). Verified, previously published files can be reused without a request while an explicit HTTP freshness lifetime is valid. Without such a lifetime, the downloader contacts the server every run, using conditional GET with the server's `ETag` or `Last-Modified` when available.

There is no freshness heuristic, local-mtime HEAD check, or remote-size equality shortcut. `no-store`, `no-cache`, and `Vary` constrain reuse. Missing or corrupt local files require a full download, even if cached policy metadata is fresh. Stale-on-error reuse is allowed only by the applicable HTTP policy.

Filenames and URL-to-path mapping are unchanged. Different download/artifact identities targeting the same path are rejected; use distinct destinations rather than relying on overwrites.

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

JSONPath-Plus expression(s) used to find URLs. Overrides `mediaPattern`.

### `maxConcurrent`

- **Type:** Positive integer
- **Default:** `4`

Maximum number of simultaneous downloads.

### `ignoreCache`

- **Type:** `boolean`
- **Default:** `false`

When `true`, downloads unconditionally instead of reusing a fresh file or sending cached validators. This does not change filenames or clear artifact metadata for other recipes.

### `forceClearTempFiles`

- **Type:** `boolean`
- **Default:** `false`

Clears this transform's temporary files before downloading, without recreating that directory. Downloads write directly into the run's staged download tree; when this option is `false`, the downloader does not create or clean a separate transform-temp tree. It does **not** invalidate HTTP cache records or delete published downloads. For metadata invalidation, use [cache-only clearing](../artifact-cache.md#clearing).

### `transformLocalPath`

- **Type:** `(localPath: string) => string`
- **Default:** `undefined`

Changes the destination path derived from each URL. Return a relative path within the source's download directory. Different remote resources must not claim the same destination.

### `maxTimeout`

- **Type:** Positive integer
- **Default:** `10000`

HTTP request timeout in milliseconds.

### `abortOnError`

- **Type:** `boolean`
- **Default:** `true`

When `true`, download errors fail the transform. When `false`, errors are logged without failing the transform, so failed media downloads may be absent from published output. This does not authorize stale cache reuse outside HTTP policy.

### `updatePaths`

- **Type:** `boolean`
- **Default:** `true`

Replaces media URLs in content with local paths relative to the source's download directory. Keep this enabled when a following Sharp transform needs to read downloaded images.

The former validator and content-length check toggles have been removed. HTTP policy determines freshness and validation automatically. This transform requires Node.js 24.x or 26 and later (`^24 || >=26`).
