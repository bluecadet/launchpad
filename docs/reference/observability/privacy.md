---
title: "Observability privacy and delivery limits"
---

Enabling observability sends data from the machine to every configured destination. Launchpad has no default Bluecadet endpoint.

## Review data before enabling export

Logs can contain message arguments and event metadata from your application or plugins. The logging layer normalizes and key-redacts records before writing canonical JSONL, and destinations export that canonical form.

Redaction is key-based. It covers recognized keys such as token, password, authorization, or API-key fields, including nested fields, but it cannot detect every secret. A credential in an ordinary field, interpolated into a message, embedded in a URL, or stored under an unrecognized key can still be exported.

Before enabling a destination:

1. Review application log calls and the event patterns in `include`.
2. Do not log credentials, personal data, access URLs, or raw request bodies.
3. Use `exclude` to suppress event families that are not appropriate for the destination.
4. Keep resource and metric-point attributes low-cardinality and non-sensitive.
5. Protect destination tokens with your deployment secret manager and TLS.
6. Verify retention, access, and regional requirements in the receiving system.

Metrics are bounded current-state gauges, but their resource and metric-point attributes can still identify a machine or deployment. The two attribute scopes are configured and exported separately. Log patterns do not affect metrics; set `metrics: false` to keep them on the machine.

## Local canonical logs

The controller writes canonical structured logs to its logging directory even when remote observability is disabled. The file holds normalized logger calls and selected operational lifecycle events, each with the resource snapshot in effect when the record was created. Treat the logging directory as sensitive application data.

Launchpad's destination and checkpoint handling never writes destination credentials, authorization headers, or complete destination configuration into canonical records or checkpoints. Checkpoint keys must also be credential-free. Application log messages are a separate risk: free-form strings can contain secrets that key-based redaction misses. Keep secrets out of log calls. File permissions, full-disk encryption, backup access, and secure deletion are deployment responsibilities.

The optional text log is on by default at `info` and above. It holds the same selected records in a human-readable, optionally customized format, filtered at its configured level. It is not the canonical machine-readable schema.

## Delivery is bounded, not exactly once

With explicit `logStorage: { type: 'memory' }`, destination logs use capped in-memory queues. Process exit, crash, queue overflow, delivery deadlines, permanent rejection, or exhausted retries can lose buffered data.

By default (omitted `logStorage` or `{ type: 'file' }`), each destination tracks progress through retained canonical JSONL. This permits replay after restart, but delivery is neither lossless nor exactly once:

- a backend may accept a batch before Launchpad loses the acknowledgement, causing duplicate replay;
- rotation or retention can expire unread records;
- disk-full, write, or admission-capacity failures can prevent records from entering the canonical log;
- a corrupt checkpoint or source gap causes conservative replay where possible and a visible gap report;
- a backend can reject historical timestamps even though Launchpad preserves them; and
- a forced exit can end bounded shutdown before delivery finishes.

When the canonical file source is unavailable or writes fail, Launchpad does not switch to in-memory delivery, and the logging failure does not crash the application. Loss counters are exact only when the source can prove a record count; otherwise diagnostics report an unknown-size gap.

Retryable failures, delivery timeouts, exhausted attempts, and interrupted shutdown do not advance the checkpoint. A permanent export failure parks that destination's file reader with its records pending until restart or configuration repair. OTLP partial success is terminal for the batch: accepted and rejected counts are recorded, then the whole batch is acknowledged because the response cannot identify individual rejected records.

A new destination starts at the oldest retained record, which can backfill historical data and raise ingestion costs. Restarting with the same destination identity and controller source resumes from its checkpoint. Canonical retention is bounded by default. Replay keeps original timestamps, so choose a backend that accepts timestamps as old as your longest expected offline interval. Metrics are current in-memory snapshots and are never replayed.

Launchpad provides no central server, observability sidecar, alerting rules, or dashboard.
