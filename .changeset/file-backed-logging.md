---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-observability": minor
"@bluecadet/launchpad": major
"@bluecadet/create-launchpad": minor
---

Centralize controller logging in one bounded, normalized pipeline with segmented canonical JSONL, an optional default-on human-readable text view, local-filesystem ownership locking, and atomic per-destination checkpoints. Destination observability can opt into retained log delivery with `logStorage: { type: 'file' }`; memory delivery remains the default, metrics remain current snapshots, and custom file-backed destinations must declare stable checkpoint and replay-resource support.

The controller file layout is breaking: the overlapping `launchpad-info`, `launchpad-debug`, and `launchpad-error` streams are replaced by canonical `.jsonl` segments and optional `.log` segments. Existing files are left in place and are not migrated or deleted. Update tailing, backup, and cleanup rules that depend on the old filenames or severity streams before upgrading.

The project generator adds a commented file-delivery hint without enabling remote observability or file-backed delivery automatically.
