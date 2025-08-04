# mediaDownloader Content Plugin

The `mediaDownloader` plugin downloads media assets (like images and videos) referenced in your content and stores them locally. This is useful for ensuring media availability and optimizing load times.

Downloaded media files are colocated with the sources that reference them.

## Usage

To use the `mediaDownloader` plugin, include it in the list of content plugins in your configuration:

```typescript{1,6-8}
import { mediaDownloader } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    plugins: [
      mediaDownloader({
        maxConcurrent: 4
      })
    ]
  }  
});
```

## Options

### `keys`

- **Type:** `string[]`
- **Default:** `undefined`

Specifies which data keys to search for media URLs. If not provided, all keys will be searched.

### `mediaPattern`

- **Type:** `RegExp`
- **Default:** `/https?.*\.(jpe?g|png|webp|avi|mov|mp4|mpg|mpeg|webm)(\?.*)$/i`

Regex pattern to match URLs for downloading.

### `matchPath`

- **Type:** `string | string[]`
- **Default:** `undefined`

JSONPath-Plus compatible path(s) to match URLs. Overrides `mediaPattern` if provided.

### `maxConcurrent`

- **Type:** `number`
- **Default:** `4`

Number of concurrent downloads allowed.

### `ignoreCache`

- **Type:** `boolean`
- **Default:** `false`

If true, always downloads files regardless of cache status.

### `enableIfModifiedSinceCheck`

- **Type:** `boolean`
- **Default:** `true`

Enables HTTP if-modified-since check for cached files.

### `maxTimeout`

- **Type:** `number`
- **Default:** `10000`

Maximum timeout (in milliseconds) for HTTP requests.

### `updatePaths`

- **Type:** `boolean`
- **Default:** `true`

Updates downloaded media URLs in content to point to local paths. Required for using the 'sharp' plugin.
