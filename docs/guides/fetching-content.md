# Fetching content

Launchpad fetches content from configured sources, transforms it, and writes it to disk. This guide follows content from configuration to storage.

## Basic configuration

Add the `content` plugin to your Launchpad configuration:

```js
// launchpad.config.js
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { jsonSource } from '@bluecadet/launchpad/content/sources/json';

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

See the [content configuration reference](/reference/content/content-config/) for all options.

## Running content updates

```bash
# As part of the full Launchpad startup
npx launchpad start

# Content updates only
npx launchpad content fetch
```

See the [CLI commands reference](../reference/cli/commands.md) for details.

## Content sources

Sources define where content comes from. Built-in sources cover JSON/REST APIs and CMS platforms such as Contentful and Sanity.

See the [content sources reference](../reference/content/sources/index.md) for the available sources and how to write your own.

## Fetch lifecycle

Each `content.fetch` run writes to a staged run directory under `tempPath`:

1. Launchpad prepares a fresh staged output tree for the run.
2. It copies files from the published `downloadPath` that match `keep` into staging.
3. Sources and transforms write only into the staged tree.
4. If every source and transform succeeds, Launchpad promotes the staged output into the published `downloadPath`, including files written at the root of the staged tree.
5. If the run fails, Launchpad discards the staged output and leaves the published `downloadPath` unchanged.
6. During promotion, Launchpad moves the published path aside and restores it if the replacement cannot complete.

Fetches are therefore atomic per source directory and need no rollback from backups.

## Transforms

Transforms process content after download. Common uses:

- Converting Markdown to HTML
- Resizing images
- Validating data

See the [transforms reference](../reference/content/transforms/index.md).

## Best practices

- Rely on staged promotion for safety. The published tree stays unchanged until promotion succeeds.
- Treat `backupAndRestore` as compatibility protection. Backups remain available but are no longer the main rollback mechanism for failed fetches.
- Treat `content:document:write` paths as staged paths. Event listeners should not assume the emitted path is published.
- Handle failures with the [error handling system](../reference/content/index.md#error-handling).
- Forward logs and lifecycle events to an aggregator with the [observability package](../reference/observability/index.md) to track content updates.
- Group related content into separate sources.

## Next steps

- [Content configuration](/reference/content/content-config/)
- [Content sources](../reference/content/sources/index.md)
- [Transforms](../reference/content/transforms/index.md)
- [Error handling](../reference/content/index.md#error-handling)
- [Content reference](../reference/content/index.md) for the full API
