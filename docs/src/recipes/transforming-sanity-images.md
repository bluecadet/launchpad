# Transforming Sanity Images

When working with Sanity.io images, you can leverage Sanity's built-in image transformation capabilities instead of using the `sharp` plugin. This is particularly useful for handling Sanity's hotspot and crop features.

## Fetching Images with GROQ

First, ensure your GROQ query includes all necessary image fields:

```typescript{12-17}
import { defineConfig } from '@bluecadet/launchpad-cli';
import { sanitySource } from '@bluecadet/launchpad-content/sources/sanity';

export default defineConfig({
  content: {
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
    plugins: [
      mediaDownloader()
    ]
  }
});
```

The `asset->` reference is crucial for accessing the full image data, including hotspot and crop information.

## Using the Image URL Transform Plugin

Add the `sanityImageUrlTransform` plugin to transform image references into URLs:

```typescript{15-23}
import { defineConfig } from '@bluecadet/launchpad-cli';
import { sanitySource } from '@bluecadet/launchpad-content/sources/sanity';
import { sanityImageUrlTransform } from '@bluecadet/launchpad-content/plugins/sanity-image-url-transform';

export default defineConfig({
  content: {
    sources: [
      sanitySource({
        id: 'content',
        projectId: 'your-project-id',
        queries: [/* ... */]
      })
    ],
    plugins: [
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
  }
});
```

>[!TIP]
>It's added _before_ the mediaDownloader (unlike the `sharp` plugin) because it modifies the image URLs before they are downloaded. Conversely, the `sharp` plugin modifies the image files after they are downloaded.

## Available Transformations

Sanity's image URL builder supports many transformations:

```typescript
import { defineConfig } from '@bluecadet/launchpad-core';
import { sanityImageUrlTransform, sanitySource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    sources: [
      sanitySource({
        id: 'content',
        projectId: 'your-project-id',
        queries: [/* ... */]
      })
    ],
    plugins: [
      sanityImageUrlTransform({
        projectId: 'your-project-id',
        dataset: 'production',
        buildUrl: (builder) => builder
          .width(800)                    // Set width
          .height(600)                   // Set height
          .format('webp')               // Convert format
          .quality(80)                  // Adjust quality
          .auto('format')               // Auto-select best format
          .fit('crop')                  // Crop fitting
          .crop('center')               // Crop position
          .blur(10)                     // Apply blur
      }),
      mediaDownloader()
    ]
  }
});
```

## Resources

- [Sanity Image URLs Reference](https://www.sanity.io/docs/image-url)
- [Image Image Presentation Documentation](https://www.sanity.io/docs/presenting-images)
- [sanityImageUrlTransform Plugin](../reference/content/plugins/sanity-image-url-transform.md)
- [Sanity Content Source](../reference/content/sources/sanity-source.md)

Unlike the `sharp` plugin, Sanity's image transformations are performed on their CDN, reducing your build time and server load.
