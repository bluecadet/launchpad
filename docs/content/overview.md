# Content Management

The Launchpad Content system downloads and processes content from various sources. It uses a plugin system to transform content and download media files.

## Basic Usage

```js
import { defineConfig } from '@bluecadet/launchpad-cli';
import { jsonSource, mdToHtml, mediaDownloader } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    // Define content sources
    sources: [
      jsonSource({
        id: 'blog',
        files: {
          'posts.json': 'https://api.example.com/posts'
        }
      })
    ],
    // Configure content processing
    plugins: [
      // Convert markdown to HTML
      mdToHtml({
        path: '$.content'
      }),
      // Download referenced media
      mediaDownloader({
        mediaPattern: /\.(jpg|png|mp4)$/i
      })
    ]
  }
});
```

## Content Sources

Sources are functions that create content fetchers. Each source:
- Has a unique ID
- Downloads content from a specific API
- Returns content in a standardized format
- Uses `neverthrow` for error handling

Available sources:
- [JSON Source](./sources/json) - Any HTTP JSON API
- [Airtable Source](./sources/airtable) - Airtable bases
- [Contentful Source](./sources/contentful) - Contentful CMS
- [Sanity Source](./sources/sanity) - Sanity.io
- [Strapi Source](./sources/strapi) - Strapi CMS

## Content Plugins

Plugins process content after it's downloaded. Common use cases:
- Converting markdown to HTML
- Downloading media files
- Custom transformations

Built-in plugins:
- [Markdown to HTML](./plugins/md-to-html)
- [Sanity Transforms](./plugins/sanity-transforms)
- [Media Downloader](./plugins/media-downloader)

## Content Flow

1. **Source Setup**
   ```js
   jsonSource({
     id: 'blog',
     files: { /* ... */ }
   });
   ```

3. **Plugin Processing**
   ```js
   // Plugins transform content in the DataStore
   mdToHtml({
     path: '$.content'
   });
   ```

4. **File Output**
   ```
   .downloads/
   └── blog/              # Source ID
       ├── posts.json     # Content files
       └── media/         # Downloaded media
   ```

## Error Handling

The system uses `neverthrow` for robust error handling. If an error occurs, or a plugin throws an error, the error is logged and the backup is restored.

## Caching & Updates

Content is cached intelligently:
- HTTP caching headers respected
- Media files cached locally
- Transform results cached
- Automatic backup and restore

[Learn more about caching](./caching)