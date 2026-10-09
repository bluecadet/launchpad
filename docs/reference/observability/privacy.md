---
title: "Observability Privacy and Delivery Limits"
---

Enabling observability sends data from the machine to every configured destination. Launchpad does not send telemetry to a default Bluecadet endpoint.

## Review data before enabling export

Logs can contain message arguments and event metadata supplied by your application or plugins. The logging layer safely normalizes and key-redacts records before writing canonical JSONL; destinations export that canonical representation. Normalization is not complete secret detection.

Redaction is key-based. It can cover recognized keys such as token, password, authorization, or API-key fields, including nested fields, but it cannot identify every secret. A credential placed in an ordinary field, interpolated into a message, embedded in a URL, or stored in an unrecognized key can still be exported.

Before enabling a destination:

1. Review application log calls and the event patterns in `include`.
2. Do not log credentials, personal data, access URLs, or raw request bodies.
3. Use `exclude` to suppress event families that are not appropriate for the destination.
4. Keep resource and metric-point attributes low-cardinality and non-sensitive.
5. Protect destination tokens with your deployment secret manager and TLS.
6. Verify retention, access, and regional requirements in the receiving system.

Metrics are bounded current-state gauges, but their resource and metric-point attributes can still identify a machine or deployment. The two attribute scopes are configured and exported separately. Disabling log patterns does not disable metrics; set `metrics: false` when those observations must not leave the machine.

## Local canonical logs

The controller writes canonical structured logs to its configured logging directory even when remote observability is disabled. That file includes normalized logger calls and selected operational lifecycle events, together with the resource snapshot that applied when each record was created. Treat the logging directory as sensitive application data.

Launchpad's automatic destination configuration and checkpoint handling do not write destination credentials, authorization headers, or complete destination configuration into canonical records or checkpoints. Checkpoint keys must also be credential-free. This does not make arbitrary application log messages safe: free-form strings can contain secrets, and key-based redaction cannot guarantee their removal. Avoid logging secrets and review application logging at the source. File permissions, full-disk encryption, backup access, and secure deletion remain deployment responsibilities.

The optional text log contains the same selected records in a human-readable, optionally customized format, filtered at its configured level. It is not the canonical machine-readable schema.

## Delivery is bounded, not exactly once

Without `logStorage`, destination logs use capped in-memory queues. Process exit or crash can lose buffered data, as can queue overflow, delivery deadlines, permanent rejection, or exhausted retries.

With `logStorage: { type: 'file' }`, each destination acknowledges progress through retained canonical JSONL. This permits replay after restart, but it is neither lossless nor exactly once:

- a backend may accept a batch before Launchpad loses the acknowledgement, causing duplicate replay;
- rotation or retention can expire unread records;
- disk-full, write, or admission-capacity failures can prevent records from entering the canonical log;
- a corrupt checkpoint or source gap causes conservative replay where possible and a visible gap report;
- a backend can reject historical timestamps even though Launchpad preserves them; and
- a forced exit can end bounded shutdown before delivery finishes.

Launchpad does not silently switch to an in-memory delivery path when canonical file writes fail, and logging failure does not intentionally crash the application. Loss counters are exact only when the source can prove a record count; otherwise diagnostics report an unknown-size gap.

Retryable failures, delivery timeouts, exhausted attempts, and interrupted shutdown do not advance the checkpoint. A permanent export failure parks that destination's file reader with its records pending until restart or configuration repair. OTLP partial success is terminal for the batch: accepted and rejected counts are recorded, then the whole batch is acknowledged because the response cannot identify individual rejected records.

Canonical retention defaults are bounded. Choose a receiving backend whose accepted timestamp age covers the expected offline interval; replay keeps the original timestamp rather than making old activity appear current. Metrics remain current in-memory snapshots and are not replayed.

Launchpad provides no central server, observability sidecar, alerting rules, or dashboard.
