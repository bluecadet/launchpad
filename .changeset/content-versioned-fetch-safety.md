---
"@bluecadet/launchpad-content": patch
---

Harden versioned-output promotion against same-second collisions. Two fetches promoted within the same UTC second previously minted the same second-granular version id; the second promotion's move failed and its error cleanup could delete the first fetch's live, manifest-referenced version. Promotion now resolves a collision-free id up front (bumping to a lexically-ordered `<id>-01` suffix when the directory already exists) before moving, so the move never lands on an existing version and error cleanup can only ever remove this run's own directory. Orphan cleanup on the error path now uses the same retry policy as the retention sweep, and the sweep additionally reaps stale `.manifest.json.tmp-*` scratch files left by a crash mid-write.

Reject a `content.fetch` that names a subset of sources while versioning is enabled. Promotion moves the entire staged root and rebuilds the manifest from the fetched sources, so a subset fetch would silently drop every unfetched source from the active version. Subset fetches remain supported in the flat output mode.
