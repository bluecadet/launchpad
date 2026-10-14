---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-observability": minor
"@bluecadet/launchpad": major
"@bluecadet/create-launchpad": minor
---

Centralize controller logging in one bounded, normalized pipeline with segmented canonical JSONL, an optional default-on human-readable text view, local-filesystem ownership locking, and atomic per-destination checkpoints. Configuring observability destinations now automatically uses retained canonical log delivery and checkpoints; `logStorage: { type: 'memory' }` explicitly opts out. Metrics remain latest, coalesced in-memory snapshots. Custom log exporters must provide a stable checkpoint key and an `exportCanonical(batch, context)` method accepting normalized records with their historical resource snapshot, or explicitly use memory delivery. Legacy transports retain their in-memory behavior and reject either `logStorage` value. New destinations backfill from the oldest retained record, which can increase ingestion costs or encounter backend timestamp rejection; bounded retention can expire unread records, and lost acknowledgements can cause duplicates.

This is a major release of `@bluecadet/launchpad-controller` and the umbrella `@bluecadet/launchpad`, which exposes the same breaking logging contracts. Resolved `logging.maxSize` and `logging.maxFiles` values change from strings to numbers (bytes and milliseconds, respectively), and count-based `maxFiles` settings are no longer accepted; use age-based retention such as `'28d'`.

The controller file layout is breaking: the overlapping `launchpad-info`, `launchpad-debug`, and `launchpad-error` streams are replaced by canonical `.jsonl` segments and optional `.log` segments. Existing files are left in place and are not migrated or deleted. Update tailing, backup, and cleanup rules that depend on the old filenames or severity streams before upgrading.

The project generator adds a commented memory-delivery opt-out. Remote observability remains optional and endpoint-gated; once destinations are configured, file-backed log delivery is automatic.
