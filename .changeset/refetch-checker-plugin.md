---
"@bluecadet/launchpad-content": minor
---

Add `refetchChecker`, a packaged check-before-fetch plugin. Its `refetch.check` command asks the CMS for its latest modification value via a user-supplied `getLatestModifiedAt` probe and dispatches `content.fetch` only when that value is newer, so fast schedules stop minting a new content version (and reloading every polling app) on identical content. The first check after boot compares against the active manifest's `generatedAt`; later checks compare CMS values in memory; a missing or unreadable manifest fetches unconditionally.

Add a `content.manifest.read` command that returns the active version manifest as JSON-safe data (`ok`/`missing`/`invalid`). `refetchChecker` uses it to find its baseline without duplicating `downloadPath`; IPC consumers and other plugins can use it to read the manifest without knowing its on-disk location.

Export the manifest read API (`readManifest`, `Manifest`, `ManifestReadResult`, `ManifestError`, `MANIFEST_FILENAME`) from the package root.
