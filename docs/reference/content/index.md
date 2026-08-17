---
title: "@bluecadet/launchpad-content"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/content) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-content) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/content/CHANGELOG.md)

The content package downloads, transforms, and manages content from external sources. It provides a plugin-based architecture for building content pipelines.

## Features

- **Extensible Source System**: Easily connect to any content source:
  - Build custom source adapters with a simple interface
  - Includes ready-to-use adapters for popular CMSs (Contentful, Airtable, Sanity, etc.)
  - Type-safe data fetching and validation

- **Flexible Plugin Architecture**: Transform and process content your way:
  - Create custom plugins with straightforward APIs
  - Chain multiple transformations
  - Built-in plugins for common tasks (Markdown, image processing, etc.)
  - Full control over the content pipeline

- **Robust Content Management**:
  - Intelligent diffing for efficient updates
  - Automatic backup and recovery
  - Configurable file organization
  - Temporary file cleanup
  - Progress tracking and detailed logging

## Installation

```bash
npm install @bluecadet/launchpad
```

## JS API Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { jsonSource } from '@bluecadet/launchpad/content/sources/json';

export default defineConfig({
  plugins: [
    content({
      sources: [
        jsonSource({
          id: 'local',
          files: {
            content: 'https://example.com/content.json',
          },
        }),
      ],
      transforms: [],
      downloadPath: './content',
    }),
  ],
  workflows: {
    start: [{ type: 'content.fetch' }],
  },
});
```

## Configuration

Content operations are configured through a `ContentConfig` object that specifies:

- **Sources**: Array of content sources to fetch from
- **Transforms**: Array of transforms for content processing
- **Paths**: Various path configurations for content storage
- **Backup Options**: Settings for content backup and restoration

See the [Content Config](./content-config.md) section for detailed configuration options.

## Transforms

The transform system is core to the content package's functionality. Transforms can:

- Transform content formats
- Process media files
- Add custom processing steps
- Handle errors and logging

Learn more about available transforms and creating custom ones in the [Transforms](./transforms/index.md) section.

## Error Handling

The package uses the `neverthrow` library for robust error handling:

- Type-safe error handling
- Clear error boundaries
- Graceful failure recovery
- Automatic backup restoration on errors when configured
