# Downloading media

Add media downloading and image processing to a configured content source. Launchpad requires Node.js 24.x or 26 and later because the shared artifact cache uses `node:sqlite`.

## Overview

When your content includes media such as images or videos, Launchpad can:

1. Detect media URLs in your content
2. Download the files locally
3. Point content references at the local files
4. Transform the files (resize images, convert formats, etc.)

## Basic setup

Add the `mediaDownloader` plugin to your configuration:

```ts {3,12-14}
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms';

export default defineConfig({
  plugins: [
    content({
      sources: [
        // ...
      ],
      transforms: [
        mediaDownloader({
          maxConcurrent: 4 // number of simultaneous downloads
        })
      ]
    })
  ],
});
```

The media downloader scans your content for media URLs, downloads the files to your content directory, and rewrites the URLs to point to the local files.

## Image transformations

To resize, convert, optimize, or apply effects to downloaded images, add the `sharp` plugin *after* the media downloader:

```ts
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader, sharp } from '@bluecadet/launchpad/content/transforms';

export default defineConfig({
  plugins: [
    content({
      sources: [ /* ... */ ],
      transforms: [
        mediaDownloader(),
        sharp({
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

>[!TIP]
>The `sharp` plugin wraps the [sharp](https://sharp.pixelplumbing.com/) image processing library. See its documentation for all available transformations.

## Common transformations

```ts
// Resize to specific dimensions
sharp({
  buildTransform: (t) => t.resize(800, 600)
})

// Convert to specific format
sharp({
  buildTransform: (t) => t.webp({ quality: 80 })
})

// Multiple operations
sharp({
  buildTransform: (t) => t
    .resize(1200, 800)
    .rotate(90)
    .grayscale()
})
```

## Fetch and reuse media

Run a content update after adding the transforms:

```bash
npx launchpad content fetch
```

Downloads and generated images go into the current run's staging tree. Launchpad publishes that tree only after the run succeeds.

On later fetches, Launchpad skips the network for downloaded media while the server's explicit freshness lifetime is valid. Otherwise it contacts the server, sending a conditional GET when validators are available. Media from servers without an explicit freshness lifetime is revalidated every run. Caching does not guarantee offline availability.

Supported Sharp recipes reuse outputs when the local input bytes, resolved options, supported dependencies, and engine versions match. Ordinary image resizing needs no version token. Recipes with unsupported or unresolved dependencies run uncached and log a diagnostic.

Metadata lives in `.launchpad/cache/artifacts.sqlite`. The cached bodies are the previously published files, not a separate blob store. After upgrading, files without trusted metadata may be downloaded or generated again on the first run.

## Force a new download

To bypass HTTP reuse and cached validators, set `ignoreCache` on the downloader:

```typescript
mediaDownloader({ ignoreCache: true })
```

Run a fetch, then remove the flag to restore normal HTTP caching. Sharp may still reuse a derived image if the new bytes and recipe are unchanged.

`forceClearTempFiles` removes only temporary staging files. To invalidate metadata while keeping published files available to applications, run `content.clear` with `downloads: false, cache: true` between runs. See the [clearing reference](../reference/content/artifact-cache.md#clearing) for a dispatch example.

## Best practices

- Put `mediaDownloader` before Sharp or custom transforms that read downloaded files.
- Keep `updatePaths` enabled when Sharp needs local image paths.
- Give different URLs or recipes distinct output destinations. Launchpad rejects conflicting cache identities instead of overwriting them.
- Leave publication and cache cleanup to Launchpad. Parallel tasks within a run are supported; concurrent project writers are not.

## Troubleshooting

If media isn't downloading:

1. Check your network connection
2. Verify the media URLs are reachable
3. Check write permissions on the download directory
4. Look for errors in the console output

If transformations aren't working:

1. Confirm the media downloaded
2. Check the sharp plugin configuration
3. Verify the input image format is supported
4. Look for transform-specific errors

## Next steps

- [Content transforms](../reference/content/transforms/index.md)
- [Sharp plugin options](../reference/content/transforms/sharp.md)
- [Media downloader configuration](../reference/content/transforms/media-downloader.md)
- [Artifact cache reference](../reference/content/artifact-cache.md)
