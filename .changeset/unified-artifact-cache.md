---
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad": major
---

Reuse HTTP downloads, supported Sharp transforms, and custom `cache.derive()` recipes through a shared artifact cache. HTTP reuse follows explicit server freshness and conditional GET validation.

Before upgrading:

- Remove rejected `enableIfModifiedSinceCheck` and `enableContentLengthCheck` options; exported `checkCacheStatus` and `downloadFile` helpers are removed.
- Supply `cache` in manually constructed `ContentTransformContext` values. Use `ignoreCache: true` for unconditional downloads; `forceClearTempFiles` clears staging only.

`content.clear` now supports `cache: true`; combine with `downloads: false` to invalidate metadata while keeping published files.
