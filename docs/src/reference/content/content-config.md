# Content Config

Configuration for managing content sources, transforms, and file handling settings.

## Options

### `sources`

- **Type:** `Array<ContentSource | Promise<ContentSource>>`
- **Default:** `[]`

A list of content source options that defines where content is downloaded from. You can configure multiple sources and use different source types simultaneously. Each source can be either a direct ContentSource object or a Promise that resolves to a ContentSource.

For detailed source configuration options, see [Sources Reference](./sources/index.md).

### `transforms`

- **Type:** `Array<ContentTransform>`
- **Default:** `[]`

A list of content transforms that process content after download. Transforms can modify, analyze, or enhance content before final output.

See [Content Transforms Reference](./transforms/index.md) for available transforms and usage.

### `downloadPath`

- **Type:** `string`
- **Default:** `.downloads/`

Base directory path where successfully promoted content is published. Fetch runs write into an isolated staged run directory first, then replace the published source directory only after the run succeeds. Can be absolute or relative path.

Relative paths are resolved against the directory of the launchpad configuration.

### `tempPath`

- **Type:** `string`
- **Default:** `.launchpad/tmp/`

Temporary directory path used during content processing. Launchpad creates per-run staged workspaces under this directory and removes them after the run completes.

Relative paths are resolved against the directory of the launchpad configuration.

### `backupPath`

- **Type:** `string`
- **Default:** `.launchpad/backup/`

Directory path where existing published content can be backed up before processing new downloads. This remains available for compatibility and recovery flows, but normal fetch failure handling now relies on staged output never being promoted.

Relative paths are resolved against the directory of the launchpad configuration.

### `keep`

- **Type:** `string[]`
- **Default:** `[]`

Glob patterns for files to preserve when clearing directories.

Example:

- `["*.json"]` - Keep all JSON files
- `["**/*.csv", "*.git*"]` - Keep all CSV files in any subdirectory, and any git related files.

### `backupAndRestore`

- **Type:** `boolean`
- **Default:** `true`

When enabled:

- Creates a backup of existing published files before a fetch run
- Allows Launchpad to restore published content from backup during compatibility recovery flows
- Provides an extra safety net for promotion/recovery problems

Normal fetch failures do not require backup restoration because staged output is discarded until promotion succeeds. Error state is only marked as `restored: true` when at least one source was actually restored from backup.

### `maxTimeout`

- **Type:** `number`
- **Default:** `30000`

Maximum time in milliseconds to wait for network requests before timing out.

### `encodeChars`

- **Type:** `string`
- **Default:** `<>:"|?*`

Special characters to encode in file paths for both content and media downloads. Ensures valid filenames across systems.
