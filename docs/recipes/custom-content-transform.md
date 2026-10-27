# Creating a custom content transform

Transforms process, modify, or augment downloaded content. They work inside the current run's staged output, before Launchpad promotes it to the download directory.

## Overview

Content transforms:

- Run after all sources are fetched, one at a time, in declaration order
- Receive a `DataStore` containing all fetched documents
- Can read and mutate document data with JSONPath expressions
- Commonly download media, convert formats, or enrich data

## Basic transform structure

Create a transform with `defineContentTransform` from `@bluecadet/launchpad/content`:

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

## Example: uppercase titles

This transform uppercases the `title` field in every document:

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

## Targeting specific documents

Use `data.filter()` to select documents by source or document ID:

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

## Using JSONPath to modify nested fields

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

## Transform context

The `apply` function receives a `ContentTransformContext`:

| Property | Description |
|---|---|
| `data` | `DataStore` with read/write access to all fetched documents |
| `cache` | Run-owned artifact cache; use `cache.derive()` for generated files |
| `logger` | Logger instance for structured output |
| `contentOptions` | Resolved content configuration (download paths, etc.) |
| `paths` | Path helpers: `getTempPath`, `getDownloadPath`, `getStagedDownloadPath`, `getPublishedDownloadPath`, `getBackupPath`, `getRunPath`; `getTempPath` is pre-bound to this transform's name |
| `eventBus` | Event bus for emitting TTY progress events |
| `abortSignal` | Abort signal; check it to cancel long-running work |
| `cwd` | Working directory for the current run |

## Report progress without caching

Use `ContentProgressLogger` to count successful tasks. It needs no cache setup or utility-package import. This example counts one task per document after its URL updates succeed:

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

Call `complete()` after the awaited work so failed or cancelled tasks don't count as successes. The sequential loop guarantees no work is still running when `finally` closes the logger. With concurrent tasks, wait for every started task to settle before cleanup; `Promise.all()` can reject before the remaining tasks finish.

See the [progress logging reference](../reference/content/progress-logging.md) for options, read-only counters, and event behavior.

## Cache generated files

Use `cache.derive()` when a transform generates files from local inputs. Declare the source, every input and dependency file, resolved options, a recipe revision, and relative output paths. On a miss, the callback writes into staging; on a hit, the cache copies verified published files into staging.

This example creates a video poster with an `ffmpeg` executable on `PATH`. Launchpad does not install or detect ffmpeg, so install it yourself and pass the version you deploy. Declare this transform **after** `mediaDownloader` so the input video exists locally.

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

Pass the resolved `derive()` result to `progress.complete(result)` outside `generate`. Hits skip the callback, and both hits and misses must finish file verification (and copying, on reuse) before the task counts as successful. The logger counts this recipe as one task, not bytes or output files. Closing the progress logger does not close the shared cache.

For example, configure it with `sourceId: 'videos'`, `input: 'clips/welcome.mp4'`, `output: 'posters/welcome.jpg'`, and your deployed `ffmpegVersion`. The paths must match your downloader's local paths. The transform writes a file but does not rewrite document references.

Add file dependencies such as a watermark or filter script to `inputs`. Put non-file dependencies such as tool versions in `options`, and bump `version` when the recipe or code changes. Unlike Sharp, custom recipes get no automatic engine or dependency discovery. Keep generation deterministic for its declared inputs and options.

Input hashes verify local bytes, not remote changes, so the downloader must fetch or revalidate remote media first. Keep inputs stable during generation: within-run fingerprint reuse cannot detect same-size edits that preserve modification time. To be cached, outputs must be relative paths inside the source's staged tree and differ from the input paths. In-place work runs uncached. Missing declared inputs or outputs are errors. Different identities cannot claim the same cached destination.

Await `derive()` and any parallel tasks before returning. Do not close or abort the shared cache from a callback; Launchpad owns its lifecycle. See the [artifact cache reference](../reference/content/artifact-cache.md#derived-artifacts-cachederive) for the full contract.

## Handling cancellation

In long-running transforms, check `abortSignal` so the transform can stop cleanly:

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

## Best practices

1. Choose a unique `name`. Launchpad uses it in logs and to scope temp directories.
2. Write only into staged output. `paths.getDownloadPath()` points at the current run's staged download tree.
3. Treat published files as read-only. To inspect them, use `paths.getPublishedDownloadPath()`, and don't modify them during a fetch.
4. Handle errors. An unhandled exception aborts the fetch pipeline and prevents promotion.
5. Check `abortSignal` in loops and before expensive operations.
6. Prefer `document.apply()` for field-level changes over rewriting the whole document.

>[!TIP]
>Transforms run in declaration order. Declare a transform after any transform whose output it needs; for example, `sharp` needs the staged files `mediaDownloader` writes.

## Next steps

- [Built-in transforms](../reference/content/transforms/index.md) for implementation examples
- [Media downloader transform](../reference/content/transforms/media-downloader.md)
- [Content configuration reference](/reference/content/content-config/) for all config options
