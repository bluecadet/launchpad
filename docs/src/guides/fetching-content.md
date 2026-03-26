# Fetching Content

Launchpad's content fetching process is designed to be flexible and robust, allowing you to fetch, transform, and manage content from various sources. This guide provides an overview of how content flows through Launchpad, from configuration to storage.

## Basic Configuration

Content fetching requires a `ContentConfig` object in your Launchpad configuration:

```js
// launchpad.config.js
import { defineConfig } from '@bluecadet/launchpad-cli';
import { content } from '@bluecadet/launchpad-content';
import { jsonSource } from '@bluecadet/launchpad-content/sources/json';

export default defineConfig({
  plugins: [
    content({
      sources: [
        jsonSource({
          id: "example-source",
          files: {
            "example.json": "https://example.com/api/data",
          },
        }),
      ],
      transforms: [], // Add transforms here
      downloadPath: './content',
      backupAndRestore: true,
    }),
  ],
});
```

See the [Content Configuration Reference](/reference/content/content-config.md) for all options.

## Running Content Updates

You can update content in two ways:

```bash
# As part of the full Launchpad startup
npx launchpad start

# Content updates only
npx launchpad content
```

See the [CLI Commands Reference](../reference/cli/commands.md) for more details.

## Content Sources

Sources define where your content comes from. Launchpad includes several built-in sources:

- JSON/REST APIs
- CMS platforms (Contentful, Sanity, etc.)

Check the [Content Sources Reference](../reference/content/sources/index.md) to learn more about available sources and how to create custom ones.

## Transforms

Transforms process your content after it's downloaded. Common use cases include:

- Converting Markdown to HTML
- Resizing images
- Validating data
- Custom transformations

Learn more in the [Transforms Reference](../reference/content/transforms/index.md).

## Best Practices

- **Use Backup and Restore**: Enable `backupAndRestore` to automatically recover from failures
- **Implement Error Handling**: Use the [error handling system](../reference/content/index.md#error-handling) to gracefully handle failures
- **Monitor Progress**: Use the [logging system](../reference/content/index.md#logging) to track content updates
- **Organize Sources**: Group related content into separate sources for better management
- **Cache Effectively**: Configure appropriate cache settings for your content type

## Next Steps

- Read about [Content Configuration](../reference/content/content-config.md)
- Learn about [Content Sources](../reference/content/sources/index.md)
- Explore [Transforms](../reference/content/transforms/index.md)
- Understanding [Error Handling](../reference/content/index.md#error-handling)

For complete API documentation, visit the [Content Reference Documentation](../reference/content/index.md).
