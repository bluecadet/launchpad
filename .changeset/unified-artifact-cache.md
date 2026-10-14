---
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad": major
---

Share a metadata-only SQLite artifact cache across HTTP media downloads, Sharp transforms, and custom `ContentTransformContext.cache.derive()` recipes. Reusable bodies stay in the published output tree; no separate blob store is created. Existing files without trusted metadata are cache misses.

HTTP reuse follows explicit server freshness and conditional GET validation. Remove `enableIfModifiedSinceCheck` and `enableContentLengthCheck` from downloader configuration: both options are rejected. The old HEAD/local-mtime and remote-size checks and their exported `checkCacheStatus` and `downloadFile` helpers are removed. Use `ignoreCache: true` for unconditional downloads. `forceClearTempFiles` clears staging only, not cache metadata.

Supported Sharp recipes automatically fingerprint input bytes, resolved options, supported dependencies, and engine versions. Optional `cacheKey` adds identity but cannot force unsupported recipes to cache. Custom recipes declare their own revisions, inputs, options, and relative output paths. Manually constructed transform contexts must supply the new `cache` field.

Serialize project writers with a permanent operating-system lease and journal metadata safety before publication. Commit records only after publication and cleanup succeed and final bytes match. Cache failures run uncached only when stale metadata can be safely invalidated or isolated; otherwise publication fails.

Add `cache` to `content.clear`. Set `downloads: false, cache: true` to invalidate metadata while keeping published files. Download clearing also invalidates selected sources. Filenames remain unchanged, and competing identities targeting one output are errors. Filename redesign in #321 is separate.
