---
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-cli": minor
---

Breaking changes to the content fetch pipeline, path helpers, and file path defaults.

### Fetch API

`LaunchpadContent` gains a `loadSources()` method. `fetch()` and `clear()` now accept source IDs (strings) instead of full source objects:

```ts
// Before
content.fetch(sourceObjects);

// After
content.fetch(sourceIds);
```

### Staged promotion model

Fetches no longer write directly to `downloadPath`. Instead, each run stages output under an isolated directory inside `tempPath`, then atomically promotes it into the published `downloadPath` only after every source and transform succeeds:

1. A fresh staged output tree is prepared under `tempPath/runs/<runId>/downloads/`.
2. Files from the currently published `downloadPath` that match `keep` rules are copied into staging.
3. Sources and transforms write into the staged tree only.
4. On success, the staged tree is promoted into `downloadPath`.
5. On failure, the staged tree is discarded and the previously published `downloadPath` is left unchanged.

This means failed fetches no longer corrupt published content without requiring `backupAndRestore`. Backup is still available as an extra safety net but is no longer the primary rollback mechanism.

**Breaking for custom transforms**: `paths.getDownloadPath()` now returns the staged run path, not the published path. If you need to read currently published files, use the new `paths.getPublishedDownloadPath()`. Do not write to the published path during a fetch run.

New path helper methods: `getPublishedDownloadPath()`, `getStagedDownloadPath()`, `getRunPath()`.

### Default file paths

Default `tempPath` changes from `.tmp/` to `.launchpad/tmp/`. Tokenization logic is removed from all path generation — backup, download, and temp paths are no longer namespaced by token.
