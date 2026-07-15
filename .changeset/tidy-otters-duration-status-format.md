---
"@bluecadet/launchpad-utils": minor
---

Add `duration` and `status-format` entry points as the canonical home for duration parsing and status-row time formatting, replacing the near-duplicate implementations scattered across `@bluecadet/launchpad-scheduler` and `@bluecadet/launchpad-content`. `duration` exports `parseDuration` (null-returning) and a `durationSchema`/`Duration` zod pair. `status-format` exports `formatDurationMs`, `formatTimeAgo`, `formatTimeUntil`, and `formatClockTime` for rendering `Row`/`Section` status entries.
