# Creating a Custom Content Transform

This recipe explains how to create a custom content transform for Launchpad. Transforms run after all sources have been fetched and allow you to process, modify, or augment downloaded content before it is written to the final download directory.

## Overview

Content transforms in Launchpad:

- Run sequentially after all sources are fetched, in the order they are declared
- Receive a `DataStore` containing all fetched documents
- Can read and mutate document data using JSONPath expressions
- Are commonly used to download media files, convert formats, or enrich data

## Basic Transform Structure

A transform is created with `defineContentTransform` from `@bluecadet/launchpad-content`:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad-content';

export const myTransform = defineContentTransform({
  name: 'my-transform',
  async apply({ data, logger }) {
    logger.info('Running my transform...');

    for (const document of data.allDocuments()) {
      await document.update((doc) => {
        // Return the modified document
        return { ...doc, processed: true };
      });
    }
  }
});
```

## Step-by-Step Example

Let's create a transform that uppercases a specific field in all documents:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad-content';

export const uppercaseTitles = defineContentTransform({
  name: 'uppercase-titles',
  async apply({ data, logger }) {
    logger.info('Uppercasing titles...');

    for (const document of data.allDocuments()) {
      await document.update((doc) => {
        const record = doc as Record<string, unknown>;
        if (typeof record.title === 'string') {
          return { ...record, title: record.title.toUpperCase() };
        }
        return record;
      });
    }
  }
});
```

Add it to your Launchpad config:

```typescript
import { defineConfig } from '@bluecadet/launchpad-cli';
import { content } from '@bluecadet/launchpad-content';
import { uppercaseTitles } from './my-transforms.js';

export default defineConfig({
  plugins: [
    content({
      sources: [ /* ... */ ],
      transforms: [
        uppercaseTitles
      ]
    })
  ]
});
```

## Targeting Specific Documents

Use `data.filter()` to target documents from a specific source or by document ID:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad-content';

export const myTransform = defineContentTransform({
  name: 'targeted-transform',
  async apply({ data, logger }) {
    // Filter to documents from the 'blog' source only
    const result = data.filter(['blog']);

    if (result.isErr()) {
      logger.error('Failed to filter documents', result.error);
      return;
    }

    for (const { namespaceId, documents } of result.value) {
      logger.info(`Processing ${documents.length} documents from '${namespaceId}'`);
      for (const document of documents) {
        await document.update((doc) => {
          // transform doc
          return doc;
        });
      }
    }
  }
});
```

## Using JSONPath to Modify Nested Fields

Use `document.apply()` with a [JSONPath-Plus](https://github.com/JSONPath-Plus/JSONPath) expression to target specific fields:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad-content';

export const normalizeUrls = defineContentTransform({
  name: 'normalize-urls',
  async apply({ data, logger }) {
    for (const document of data.allDocuments()) {
      // Apply a transform to every value matching the JSONPath expression
      await document.apply('$..imageUrl', (value) => {
        if (typeof value === 'string') {
          return value.replace('http://', 'https://');
        }
        return value;
      });
    }
  }
});
```

## Accessing the Transform Context

The `apply` function receives a `ContentTransformContext` with several useful properties:

| Property | Description |
|---|---|
| `data` | `DataStore` — read/write access to all fetched documents |
| `logger` | Logger instance for structured output |
| `contentOptions` | Resolved content configuration (download paths, etc.) |
| `paths` | Path helpers — `getTempPath`, `getDownloadPath`, `getBackupPath` pre-bound to this transform's name |
| `eventBus` | Event bus for emitting TTY progress events |
| `abortSignal` | Abort signal — check this to cancel long-running work gracefully |
| `cwd` | Working directory for the current run |

## Handling Cancellation

For long-running transforms, check `abortSignal` to allow graceful cancellation:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad-content';

export const slowTransform = defineContentTransform({
  name: 'slow-transform',
  async apply({ data, logger, abortSignal }) {
    for (const document of data.allDocuments()) {
      if (abortSignal.aborted) {
        logger.info('Transform aborted');
        return;
      }
      // ... process document
    }
  }
});
```

## Best Practices

1. **Choose a unique name**: The `name` is used in logs and for temp directory scoping
2. **Handle errors gracefully**: Unhandled exceptions abort the entire fetch pipeline
3. **Respect `abortSignal`**: Check it in loops or before expensive operations
4. **Use `document.apply()`** for field-level mutations instead of reading and re-writing the full document where possible

>[!TIP]
>Transforms run in declaration order. If one transform depends on the output of another (e.g. `sharp` depends on `mediaDownloader` having written files), make sure to declare them in the right order.

## Next Steps

- See [Built-in Transforms](../reference/content/transforms/index.md) for implementation examples
- Learn about the [Media Downloader Transform](../reference/content/transforms/media-downloader.md)
- Read the [Content Configuration Reference](../reference/content/content-config.md) for all config options
