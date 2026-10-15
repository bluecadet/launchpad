---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-observability": minor
"@bluecadet/create-launchpad": minor
---

Observability destinations now resume retained log delivery after restarts; `logStorage: { type: 'memory' }` opts out.

Before upgrading:

- Use age-based `logging.maxFiles` (e.g. `'28d'`), not counts. Resolved `logging.maxSize` and `logging.maxFiles` are numeric bytes and milliseconds, respectively.
- Update file tooling: JSONL and optional `.log` segments replace `launchpad-info`, `launchpad-debug`, and `launchpad-error`. Old files remain untouched.
- Custom exporters need stable `checkpointKey` and `exportCanonical(batch, context)` handling normalized records and historical resource snapshots, or explicit memory delivery. Legacy `transports` reject either `logStorage` value.
