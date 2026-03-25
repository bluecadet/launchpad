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

See [Content Transforms Reference](./plugins/index.md) for available transforms and usage.

### `downloadPath`

- **Type:** `string`
- **Default:** `.downloads/`

Base directory path where downloaded files are stored. Can be absolute or relative path.

Relative paths are resolved against the directory of the launchpad configuration.

### `tempPath`

- **Type:** `string`
- **Default:** `.launchpad/tmp/`

Temporary directory path used during content processing.

Relative paths are resolved against the directory of the launchpad configuration.

### `backupPath`

- **Type:** `string`
- **Default:** `.launchpad/backup/`

Directory path where existing content is backed up before processing new downloads. Critical for recovery if downloads fail.

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

- Creates backup of existing files before download
- Restores backup if any source download fails
- Ensures atomic success/failure of multi-source downloads

### `maxTimeout`

- **Type:** `number`
- **Default:** `30000`

Maximum time in milliseconds to wait for network requests before timing out.

### `encodeCharacters`

- **Type:** `string`
- **Default:** `<>:"|?*`

Special characters to encode in file paths for both content and media downloads. Ensures valid filenames across systems.
