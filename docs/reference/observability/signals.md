---
title: "Observability Signal Catalog"
---

Launchpad exports logs and finite, current-state gauge observations. Metrics are collected when the plugin becomes ready, every `metrics.intervalMs` in persistent mode, and once more during graceful shutdown. Event `include` and `exclude` patterns affect logs only.

Destination logs replay from the controller's retained canonical file by default; `logStorage: { type: 'memory' }` opts out. Each replayed record keeps its original timestamp and resource snapshot. Metrics are never reconstructed or backfilled from that file; after restart they remain latest-state observations from the new process.

Metrics are observations, not fleet assertions. Missing metrics can mean a plugin is absent, its state is unavailable, or a configured entity has not been observed. They do not describe desired applications, expected machines, or overall health.

## Attribute scopes

Every metric batch carries the plugin's resource attributes, including the runtime-managed `service.name` and `service.instance.id`. The attributes listed in the tables below belong to individual metric points. Resource attributes are not copied into that point scope.

Plugins define their own primitive point attributes. `service.name` and `service.instance.id` are reserved on metric points so they cannot conflict with the resource identity; other resource keys are not reserved there.

## Runtime and delivery

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad.runtime.observation.timestamp` | `ms` | — | Collection time as Unix milliseconds |
| `launchpad.runtime.start_time` | `ms` | — | Controller start time as Unix milliseconds |
| `launchpad.runtime.uptime` | `ms` | — | Elapsed time since controller start |
| `launchpad.observability.delivery.pushed_total` | — | `destination`, `signal` | Records accepted during this process lifetime |
| `launchpad.observability.delivery.dropped_total` | — | `destination`, `signal` | Records dropped during this process lifetime |
| `launchpad.observability.delivery.queue_batches` | — | `destination`, `signal` | Batches currently queued |
| `launchpad.observability.delivery.last_success_timestamp` | `ms` | `destination`, `signal` | Most recent successful export as Unix milliseconds; omitted until success |
| `launchpad.observability.source.records_lost_total` | — | `destination`, `signal` | File-source records proven lost during this process; emitted for file-backed logs |
| `launchpad.observability.source.unknown_gaps_total` | — | `destination`, `signal` | File-source gaps whose record count is unknown during this process; emitted for file-backed logs |

The `_total` observations are process-local gauges of current counters, not durable OTLP sums. Parked or unavailable file-source status is exposed in the observability plugin's destination state and controller diagnostics. A loss total increases only when the exact number is known; otherwise the unknown-gap total increases.

## Content

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_content_source_state` | — | `source`, `state` | One-hot current state: `pending`, `fetching`, `success`, or `error` |
| `launchpad_content_source_last_success_seconds` | `s` | `source` | Recorded successful fetch completion as Unix seconds |
| `launchpad_content_active_version_promoted_seconds` | `s` | — | Recorded active-version promotion as Unix seconds |
| `launchpad_content_retained_versions` | — | — | Retained count from the latest retention sweep |
| `launchpad_content_pending_delete_versions` | — | — | Pending-delete count from the latest retention sweep |

Only configured sources with state are emitted. `launchpad_content_source_last_success_seconds` appears after the first successful fetch and remains available across later fetching or error states in the same process. That history is held in memory and does not persist across restarts. The active-version promotion timestamp is present only when retention state exists. These timestamps do not establish overall content freshness and there is no `generatedAt` metric.

## Monitor

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_monitor_connected` | — | — | `1` when the monitor is currently connected to its process manager, otherwise `0` |
| `launchpad_monitor_app_status` | — | `app`, `status` | One-hot observed status: `online`, `offline`, or `errored` |

Only configured apps that have current monitor state are emitted. The status is the monitor's current observation, not authoritative readiness, crash history, or an inventory of all expected apps.

## Scheduler

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_scheduler_job_running` | — | `job` | `1` while a dispatch is in flight |
| `launchpad_scheduler_job_overlap_skips` | — | `job` | Current process count of overlap skips |
| `launchpad_scheduler_job_retry_attempt` | — | `job` | Current consecutive failed-attempt count |
| `launchpad_scheduler_job_last_success_seconds` | `s` | `job` | Latest successful completion as Unix seconds; omitted until present |
| `launchpad_scheduler_job_last_outcome` | — | `job`, `outcome` | One-hot latest outcome: `success`, `overlapSkip`, or `failure`; omitted until present |

Only configured jobs with scheduler state are emitted. Every scheduler observation is a gauge of state held by this process; the scheduler does not expose native monotonic counters.

## Custom plugin observations

Plugins can provide gauges through their `observe(state)` hook. Names must begin with a letter and contain only letters, digits, `_`, `.`, or `-`; values must be finite. Launchpad also bounds names, descriptions, and primitive attributes before delivery. Invalid observations are omitted so they cannot break a complete collection cycle.

Launchpad does not currently export traces, histograms, percentiles, or automatic process CPU and memory measurements. File-backed logs do not change this signal set.
