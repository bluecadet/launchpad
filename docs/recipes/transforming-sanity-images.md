# Transforming Sanity images

For Sanity.io images, you can use Sanity's built-in image transformations instead of the `sharp` plugin. They handle Sanity's hotspot and crop features and run on Sanity's CDN, which reduces build time and server load.

## Fetching images with GROQ

Include the image fields in your GROQ query:

```typescript {15-20}
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { sanitySource } from '@bluecadet/launchpad/content/sources/sanity';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms/media-downloader';

export default defineConfig({
  plugins: [
    content({
      sources: [
        sanitySource({
          id: 'content',
          projectId: 'your-project-id',
          queries: [{
            id: 'pages',
            query: `*[_type == "page"]{
              image {
                ...,
                asset->
              }
            }`
          }]
        })
      ],
      transforms: [
        mediaDownloader()
      ]
    })
  ]
});
```

The `asset->` dereference returns the full image data, including hotspot and crop information.

## Using the image URL transform plugin

Add the `sanityImageUrlTransform` plugin to turn image references into URLs:

```typescript {4,18-26}
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { sanitySource } from '@bluecadet/launchpad/content/sources/sanity';
import { sanityImageUrlTransform } from '@bluecadet/launchpad/content/transforms/sanity-image-url-transform';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms/media-downloader';

export default defineConfig({
  plugins: [
    content({
      sources: [
        sanitySource({
          id: 'content',
          projectId: 'your-project-id',
          queries: [/* ... */]
        })
      ],
      transforms: [
        sanityImageUrlTransform({
          projectId: 'your-project-id',
          dataset: 'production',
          buildUrl: (builder) => builder
            .width(800)
            .format('webp')
            .fit('crop')
            .crop('center')
        }),
        mediaDownloader()
      ]
    }),
  ]
});
```

>[!TIP]
>Place `sanityImageUrlTransform` _before_ `mediaDownloader` because it rewrites image URLs before download. The `sharp` plugin goes after, because it modifies files that are already downloaded.

## Available transformations

Sanity's image URL builder supports these transformations, among others:

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { sanitySource } from '@bluecadet/launchpad/content/sources/sanity';
import { sanityImageUrlTransform } from '@bluecadet/launchpad/content/transforms/sanity-image-url-transform';
import { mediaDownloader } from '@bluecadet/launchpad/content/transforms/media-downloader';

export default defineConfig({
  plugins: [
    content({
      sources: [
        sanitySource({
          id: 'content',
          projectId: 'your-project-id',
          queries: [/* ... */]
        })
      ],
      transforms: [
        sanityImageUrlTransform({
          projectId: 'your-project-id',
          dataset: 'production',
          buildUrl: (builder) => builder
            .width(800)                   // Set width
            .height(600)                  // Set height
            .format('webp')               // Convert format
            .quality(80)                  // Adjust quality
            .auto('format')               // Auto-select best format
            .fit('crop')                  // Crop fitting
            .crop('center')               // Crop position
            .blur(10)                     // Apply blur
        }),
        mediaDownloader()
      ]
    })
  ]
});
```

## Resources

- [Sanity image URLs reference](https://www.sanity.io/docs/image-url)
- [Presenting images in Sanity](https://www.sanity.io/docs/presenting-images)
- [sanityImageUrlTransform plugin](../reference/content/transforms/sanity-image-url-transform.md)
- [Sanity content source](../reference/content/sources/sanity-source.md)
