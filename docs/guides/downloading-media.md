# Downloading Media

Add media downloading and image processing to a configured content source. Run Launchpad on Node.js 24.x or 26 and later; the shared artifact cache uses `node:sqlite`.

## Overview

When you fetch content that includes media (images, videos, etc.), Launchpad can automatically:

1. Detect media URLs in your content
2. Download the files locally
3. Update content references to point to local files
4. Transform media files (resize images, convert formats, etc.)

## Basic Setup

First, add the `mediaDownloader` plugin to your configuration:

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

The media downloader will automatically:

- Scan your content for media URLs
- Download files to your content directory
- Update URLs in your content to point to local files

## Image Transformations

After downloading media, you can transform images using the `sharp` plugin. This is useful for:

- Resizing images
- Converting formats
- Optimizing quality
- Applying effects

Add the sharp plugin *after* the media downloader:

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
>The `sharp` plugin uses the powerful [sharp](https://sharp.pixelplumbing.com/) image processing library under the hood. Check their documentation for all available transformations.

## Common Transformations

Here are some useful image transformation examples:

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

## Fetch and Reuse Media

Run a content update after adding the transforms:

```bash
npx launchpad content fetch
```

Downloads and generated images go into the current run's staging tree. Launchpad publishes that tree only after the run succeeds.

On subsequent fetches, downloaded media can skip the network while an explicit server freshness lifetime is valid. Otherwise Launchpad contacts the server, using conditional GET with its validators when available. Servers without an explicit freshness lifetime are contacted every run; caching does not promise offline availability.

Supported Sharp recipes automatically reuse outputs when local input bytes, resolved options, supported dependencies, and engine versions match. You do not need to maintain a version token for ordinary image resizing. Unsupported or unresolved dependencies run uncached with a diagnostic.

Metadata is stored at `.launchpad/cache/artifacts.sqlite`; the bodies are the previously published files, not a separate blob store. Existing files without trusted metadata may be downloaded or generated again on the first run after upgrading.

## Force a New Download

To bypass HTTP reuse and cached validators, set `ignoreCache` for the downloader:

```typescript
mediaDownloader({ ignoreCache: true })
```

Run a fetch, then remove the flag to resume normal HTTP policy. Sharp may still reuse a derived image if the newly downloaded bytes and recipe have not changed.

`forceClearTempFiles` only removes temporary staging files. To invalidate metadata while leaving published files available to applications, use `content.clear` with `downloads: false, cache: true` between runs. See the [clearing reference](../reference/content/artifact-cache.md#clearing) for a dispatch example.

## Best Practices

- Put `mediaDownloader` before Sharp or custom transforms that read downloaded files.
- Keep `updatePaths` enabled when Sharp needs local image paths.
- Use distinct output destinations for different URLs or recipes; conflicting cache identities are rejected rather than overwritten.
- Leave publication ownership and cache cleanup to Launchpad. Parallel tasks within a run are supported, but concurrent project writers are not.

## Troubleshooting

If media isn't downloading:

1. Check your network connection
2. Verify media URLs are accessible
3. Ensure proper permissions in download directory
4. Look for error messages in the console output

If transformations aren't working:

1. Confirm media was downloaded successfully
2. Check sharp plugin configuration
3. Verify input image format is supported
4. Look for transform-specific error messages

## Next Steps

- Learn more about [content transforms](../reference/content/transforms/index.md)
- Explore [sharp plugin options](../reference/content/transforms/sharp.md)
- See [media downloader configuration](../reference/content/transforms/media-downloader.md)
- Read the [artifact cache reference](../reference/content/artifact-cache.md)
