# Content Plugins

Content plugins are used to transform, analyze, or enhance content after it has been downloaded. These plugins can modify the content in various ways, such as converting formats, sanitizing data, or applying custom transformations.

Content plugins can be used for a variety of tasks, including but not limited to:

- **Format Conversion**: Converting content from one format to another, such as from Markdown to HTML.
- **Data Sanitization**: Cleaning and sanitizing content to remove unwanted or harmful data.
- **Custom Transformations**: Applying custom transformations to content, such as adding metadata, restructuring data, or enhancing content with additional information.
- **Error Handling**: Managing errors that occur during content processing, such as logging errors, retrying operations, or providing fallback content.
- **Logging and Monitoring**: Tracking the content processing lifecycle, logging important events, and monitoring the performance and success of content operations.

By leveraging content plugins and their hooks, developers can create flexible and powerful content processing pipelines that meet the specific needs of their applications.

## Type Reference

```typescript
type ContentPlugin = {
  name: string;
  hooks: {
    onSetupError?: (ctx: CombinedContentHookContext, error: ContentError) => void | PromiseLike<void>;
    onContentFetchSetup?: (ctx: CombinedContentHookContext) => void | PromiseLike<void>;
    onContentFetchDone?: (ctx: CombinedContentHookContext) => void | PromiseLike<void>;
    onContentFetchError?: (
      ctx: CombinedContentHookContext,
      error: ContentError,
    ) => void | PromiseLike<void>;
  }
};
```

## Hooks

### `onSetupError`

**When:** Called when there is an error during the setup phase of the plugin.

**Why:** This hook allows the plugin to handle setup errors gracefully, possibly by logging the error or providing fallback mechanisms.

**Argument:** `ContentError` is a subclass of Error.

### `onContentFetchSetup`

**When:** Called before the content fetch process begins.

**Why:** This hook can be used to perform any necessary preparations or initializations before fetching the content. For example, it can be used to set up authentication, configure request parameters, or log the start of the fetch process.

### `onContentFetchDone`

**When:** Called after the content fetch process is completed.

**Why:** This hook provides an opportunity to process the fetched content. Plugins can use this hook to transform the content, validate it, or store it in a specific format.

### `onContentFetchError`

**When:** Called when there is an error during the content fetch process.

**Why:** This hook allows the plugin to handle fetch errors, such as retrying the fetch, logging the error, or providing alternative content.

**Argument:** `ContentError` is a subclass of Error.

## Content Plugin Context

```typescript
type CombinedContentHookContext = {
  data: DataStore;
  contentOptions: ResolvedContentConfig;
  logger: Logger;
  abortSignal: AbortSignal;
  paths: {
    getDownloadPath: (source?: string) => string;
    getTempPath: (source?: string) => string;
    getBackupPath: (source?: string) => string;
  };
};
```

### `data`

Access to the data store where content and metadata can be stored and retrieved. This data store is a proxy to the file-system, and exposes some helpers for easily modifying the data that was fetched during the source-fetch step.

### `contentOptions`

The resolved content configuration object. See [Content Config Reference](../content-config.md) for more info.

### `paths`

Helpers for retrieving the download, temp, and backup path. If no `source` is passed, then it will return the path to the respective root directory.

> [!NOTE] Note:
> The `getTempPath` function returns a directory scoped to the current plugin. Plugins do not share temp directories.

### `logger`

A plugin-specific logger.

### `abortSignal`

Signals the launchpad process is aborting. Triggered on exception or manual quit.
