---
title: "@bluecadet/launchpad-content"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/content) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-content) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/content/CHANGELOG.md)

The content package downloads, transforms, and manages content from external sources through a plugin-based pipeline.

## Features

- Source adapters for Contentful, Airtable, Sanity, Strapi, and JSON endpoints, plus a small interface for writing your own
- Type-safe data fetching and validation
- Chainable transforms, with built-in plugins for Markdown, image processing, and other common tasks
- Diffing for efficient updates
- Backup and recovery
- Configurable file organization
- Temporary file cleanup
- Progress tracking and detailed logging

## Installation

```bash
npm install @bluecadet/launchpad
```

## JS API usage

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

A `ContentConfig` object defines:

- `sources`: content sources to fetch from
- `transforms`: transforms that process fetched content
- Paths for downloads, temporary files, and backups
- Backup and restore settings

See [Content config](/reference/content/content-config/) for every option.

## Transforms

Transforms convert content formats, process media files, and add custom processing steps. See [Transforms](./transforms/index.md) for the built-in transforms and how to write your own.

## Error handling

The package uses `neverthrow` for type-safe error handling. With `backupAndRestore` enabled, Launchpad can restore published content from backup when publication fails.
