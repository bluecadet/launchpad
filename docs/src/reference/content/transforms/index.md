# Content Transforms

Content transforms are used to transform, analyze, or enhance content after all sources have been fetched. Transforms run sequentially, each receiving a context object with access to the data store, logger, resolved config, and path helpers.

## Type Reference

```typescript
type ContentTransform = {
  name: string;
  apply: (ctx: ContentTransformContext) => Promise<void>;
}

type ContentTransformContext = {
  data: DataStore;
  logger: Logger;
  contentOptions: ResolvedContentConfig;
  paths: {
    getDownloadPath: (source?: string) => string; // staged output for the current run
    getPublishedDownloadPath: (source?: string) => string;
    getStagedDownloadPath: (source?: string) => string;
    getTempPath: (source?: string) => string;  // scoped to transform.name
    getBackupPath: (source?: string) => string;
    getRunPath: (...segments: string[]) => string;
  };
  eventBus: EventBus;
  abortSignal: AbortSignal;
  cwd: string;
}
```

## Content Transform Context

### `data`

Access to the data store where content and metadata can be stored and retrieved. This data store is a proxy to the file-system, and exposes some helpers for easily modifying the data that was fetched during the source-fetch step.

### `contentOptions`

The resolved content configuration object. See [Content Config Reference](../content-config.md) for more info.

### `paths`

Helpers for retrieving staged, published, temp, backup, and run-scoped paths. `getDownloadPath()` now resolves to the staged output for the current fetch run, so built-in and custom transforms should treat it as the writable destination. This includes the root of the staged download tree, which is promoted on success alongside per-source directories. If no `source` is passed, the helper returns the root path for that scope.

> [!NOTE] Note:
> The `getTempPath` function returns a directory scoped to the current transform's `name`. Transforms do not share temp directories.
>
> `getPublishedDownloadPath` is read-only context for cases where a transform needs to inspect the currently published tree. Do not write into it during a fetch run.

### `logger`

A transform-specific logger.

## Built-in Transforms

The following transforms are available out of the box:

- `sanityToHtml` — Converts Sanity portable text to HTML
- `mdToHtml` — Converts Markdown content to HTML
- `sanityToMarkdown` — Converts Sanity portable text to Markdown
- `sanityToPlain` — Converts Sanity portable text to plain text
- `sanityImageUrlTransform` — Resolves Sanity image URLs
- `mediaDownloader` — Downloads referenced media assets
- `sharp` — Processes images using the Sharp library
- `symlink` — Creates symbolic links for content files

See the individual transform documentation pages for configuration options and usage examples.
