# Creating a Custom Content Transform

This recipe explains how to create a custom content transform for Launchpad. Transforms run after all sources have been fetched and allow you to process, modify, or augment downloaded content inside the current run's staged output before Launchpad promotes that staged tree into the final download directory.

## Overview

Content transforms in Launchpad:

- Run sequentially after all sources are fetched, in the order they are declared
- Receive a `DataStore` containing all fetched documents
- Can read and mutate document data using JSONPath expressions
- Are commonly used to download media files, convert formats, or enrich data

## Basic Transform Structure

A transform is created with `defineContentTransform` from `@bluecadet/launchpad/content`:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad/content';

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
import { defineContentTransform } from '@bluecadet/launchpad/content';

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
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
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
import { defineContentTransform } from '@bluecadet/launchpad/content';

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
import { defineContentTransform } from '@bluecadet/launchpad/content';

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
| `cache` | Run-owned artifact cache; use `cache.derive()` for generated files |
| `logger` | Logger instance for structured output |
| `contentOptions` | Resolved content configuration (download paths, etc.) |
| `paths` | Path helpers — `getTempPath`, `getDownloadPath`, `getStagedDownloadPath`, `getPublishedDownloadPath`, `getBackupPath`, `getRunPath`; `getTempPath` is pre-bound to this transform's name |
| `eventBus` | Event bus for emitting TTY progress events |
| `abortSignal` | Abort signal — check this to cancel long-running work gracefully |
| `cwd` | Working directory for the current run |

## Report Progress Without Caching

Use `ContentProgressLogger` to count successful tasks. No cache setup or utility-package import is needed. This example counts one task per document, after its URL updates succeed:

```typescript
import {
  ContentProgressLogger,
  defineContentTransform,
} from '@bluecadet/launchpad/content';

export const normalizeUrlsWithProgress = defineContentTransform({
  name: 'normalize-urls-with-progress',
  async apply({ data, eventBus, abortSignal }) {
    const documents = Array.from(data.allDocuments());
    const progress = new ContentProgressLogger({
      eventBus,
      total: documents.length,
      label: 'Normalizing document URLs',
      freshLabel: 'Updated',
    });

    try {
      for (const document of documents) {
        abortSignal.throwIfAborted();
        const result = await document.apply('$..imageUrl', (value) => {
          return typeof value === 'string'
            ? value.replace('http://', 'https://')
            : value;
        });
        if (result.isErr()) throw result.error;
        progress.complete();
      }
    } finally {
      progress.close();
    }
  },
});
```

Keep `complete()` after the awaited work so failed or cancelled tasks aren't counted as successes. The sequential loop ensures no work is still running when `finally` closes the logger. With concurrency, wait for every started task to settle before cleanup; `Promise.all()` can reject before the remaining tasks finish.

See the [progress logging reference](../reference/content/progress-logging.md) for options, read-only counters, and event behavior.

## Cache Generated Files

Use `cache.derive()` when a transform generates files from local inputs. Declare the source, every input/dependency file, resolved options, a recipe revision, and relative output paths. The callback writes into staging only on a miss; on a hit, the cache copies verified published files into staging.

This example creates a video poster using an existing `ffmpeg` executable on `PATH`. Install ffmpeg separately and supply the version of the tool you actually deploy; Launchpad does not install or discover it. Declare this transform **after** `mediaDownloader` so the input video exists locally.

```typescript
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ContentProgressLogger,
  defineContentTransform,
} from '@bluecadet/launchpad/content';

const runFile = promisify(execFile);

type VideoPosterOptions = {
  sourceId: string;
  input: string; // Relative downloaded video path
  output: string; // A distinct relative poster path
  ffmpegVersion: string;
};

export function videoPoster(options: VideoPosterOptions) {
  return defineContentTransform({
    name: 'video-poster',
    async apply({ cache, paths, abortSignal, logger, eventBus }) {
      abortSignal.throwIfAborted();
      const root = paths.getDownloadPath(options.sourceId);
      const inputPath = path.resolve(root, options.input);
      const outputPath = path.resolve(root, options.output);
      const recipe = {
        seekSeconds: 1,
        width: 640,
        ffmpegVersion: options.ffmpegVersion,
      };

      const progress = new ContentProgressLogger({
        eventBus,
        total: 1,
        label: 'Creating video poster',
        freshLabel: 'Generated',
      });

      try {
        const result = await cache.derive({
          sourceId: options.sourceId,
          namespace: 'video-poster',
          version: '1', // Bump when this generation recipe changes
          inputs: [inputPath],
          options: recipe,
          outputs: [options.output],
          async generate() {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await runFile('ffmpeg', [
              '-y', '-ss', String(recipe.seekSeconds), '-i', inputPath,
              '-frames:v', '1', '-vf', `scale=${recipe.width}:-1`, outputPath,
            ], { signal: abortSignal });
          },
        });
        progress.complete(result);
        logger.info(result.reused ? 'Reused video poster' : 'Generated video poster');
      } finally {
        progress.close();
      }
    },
  });
}
```

Pass the resolved `derive()` result to `progress.complete(result)` outside `generate`. Hits skip the callback, and both hits and misses must finish file verification (and copying on reuse) before the task counts as successful. The logger counts this recipe as one task, not bytes or output files. Closing the progress logger does not close the shared cache.

For example, configure it with `sourceId: 'videos'`, `input: 'clips/welcome.mp4'`, `output: 'posters/welcome.jpg'`, and your deployed `ffmpegVersion`. These paths must match your downloader's local paths; this transform produces a file but does not rewrite document references.

When adding a watermark, filter script, or other file dependency, add that local file to `inputs`. Include non-file dependencies such as tool versions in `options`, and bump `version` for recipe/code changes. Unlike Sharp, custom recipes do not get automatic engine or dependency discovery. Keep generation deterministic for its declared inputs and options.

Input hashes verify local bytes, not remote changes. The downloader must first fetch or revalidate remote media. Keep inputs stable throughout generation; within-run fingerprint reuse cannot detect same-size edits that preserve modification time. Outputs must be relative paths inside the source's staged tree and distinct from input paths to cache. In-place work runs uncached; missing declared inputs or outputs are errors. Different identities cannot claim the same cached destination.

Always await `derive()` and any parallel tasks before returning. Do not close or abort the shared cache from a callback; Launchpad owns that lifecycle. See the [artifact cache reference](../reference/content/artifact-cache.md#derived-artifacts-cachederive) for the full contract.

## Handling Cancellation

For long-running transforms, check `abortSignal` to allow graceful cancellation:

```typescript
import { defineContentTransform } from '@bluecadet/launchpad/content';

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
2. **Write only into staged output**: `paths.getDownloadPath()` now points at the current run's staged download tree. Treat it as the writable destination.
3. **Use published paths as read-only context**: If you need to inspect currently published files, use `paths.getPublishedDownloadPath()` and avoid mutating it during a fetch run.
4. **Handle errors gracefully**: Unhandled exceptions abort the entire fetch pipeline and prevent promotion.
5. **Respect `abortSignal`**: Check it in loops or before expensive operations.
6. **Use `document.apply()`** for field-level mutations instead of reading and re-writing the full document where possible.

>[!TIP]
>Transforms run in declaration order. If one transform depends on the output of another (for example, `sharp` depends on `mediaDownloader` having written staged files), declare them in the right order.

## Next Steps

- See [Built-in Transforms](../reference/content/transforms/index.md) for implementation examples
- Learn about the [Media Downloader Transform](../reference/content/transforms/media-downloader.md)
- Read the [Content Configuration Reference](../reference/content/content-config.md) for all config options
