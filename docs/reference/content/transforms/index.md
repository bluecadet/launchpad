# Content transforms

Content transforms modify, analyze, or enhance content after every source is fetched. They run in order, and each receives a context with the data store, shared artifact cache, logger, resolved config, and path helpers.

## Type reference

```typescript
type ContentTransform = {
  name: string;
  apply: (ctx: ContentTransformContext) => Promise<void>;
}

type ContentTransformContext = {
  data: DataStore;
  cache: ArtifactCache;
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

## Content transform context

### `data`

The data store that holds fetched content and metadata. It proxies the file system and has helpers for modifying data fetched by sources. See [DataStore](../data-store.md).

### `cache`

The run-owned `ArtifactCache`, shared by downloads and derived transforms. Call `cache.derive()` to restore or generate source-scoped files in staging. Launchpad owns publication and database cleanup, so transforms must not close, abort, or commit the cache. Await every cache operation and generation task before `apply()` returns.

See the [artifact cache reference](../artifact-cache.md) for declarations, file verification, clearing, and failure behavior, and the [custom transform recipe](../../../recipes/custom-content-transform.md#cache-generated-files) for an example.

### `contentOptions`

The resolved content configuration. See [Content config](/reference/content/content-config/).

### `paths`

Helpers that return staged, published, temp, backup, and run-scoped paths. Without a `source` argument, each helper returns the root path for its scope.

`getDownloadPath()` returns the current run's staged output, so transforms should write there. That includes the root of the staged download tree, which Launchpad promotes on success along with the per-source directories.

> [!NOTE]
> `getTempPath` returns a directory scoped to the current transform's `name`, so transforms never share temp directories.
>
> `getPublishedDownloadPath` lets a transform read the currently published tree. Do not write to it during a fetch run.

### `logger`

A transform-specific logger.

### `eventBus` and task progress

Pass `eventBus` to `ContentProgressLogger` from `@bluecadet/launchpad/content` to report completed tasks, with or without caching. It counts successful fresh and reused tasks, not bytes. The built-in media downloader and Sharp transforms use the same class.

See the [progress logging reference](../progress-logging.md) for constructor options, counters, events, and cleanup rules, and [add progress to a custom transform](../../../recipes/custom-content-transform.md#report-progress-without-caching) for a sequential example.

## Built-in transforms

Each transform's page lists its options and an example.

- [`sanityToHtml`](./sanity-to-html.md): converts Sanity Portable Text to HTML
- [`mdToHtml`](./md-to-html.md): converts Markdown to HTML
- [`sanityToMarkdown`](./sanity-to-markdown.md): converts Sanity Portable Text to Markdown
- [`sanityToPlain`](./sanity-to-plain.md): converts Sanity Portable Text to plain text
- [`sanityImageUrlTransform`](./sanity-image-url-transform.md): resolves Sanity image URLs
- [`mediaDownloader`](./media-downloader.md): downloads referenced media
- [`sharp`](./sharp.md): processes images with the Sharp library
- [`symlink`](./symlink.md): creates symbolic links
