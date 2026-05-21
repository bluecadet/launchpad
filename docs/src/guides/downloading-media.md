# Downloading Media

Media downloading is a crucial part of the Launchpad content pipeline. This guide will walk you through downloading and transforming media files from your content sources.

## Overview

When you fetch content that includes media (images, videos, etc.), Launchpad can automatically:

1. Detect media URLs in your content
2. Download the files locally
3. Update content references to point to local files
4. Transform media files (resize images, convert formats, etc.)

## Basic Setup

First, add the `mediaDownloader` plugin to your configuration:

```ts{3,12-14}
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms/media-downloader';

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

```ts{4,11-15}
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms/media-downloader';
import { sharp } from '@bluecadet/launchpad/content/transforms/sharp';

export default defineConfig({
  plugins: [
    content({
      plugins: [
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

## Best Practices

- **Enable Caching**: Launchpad automatically caches downloaded and transformed files
- **Order Plugins Correctly**: Always put `mediaDownloader` before `sharp` plugins

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
