---
title: "Observability signal catalog"
---

Launchpad exports logs and finite, current-state gauges. It collects metrics when the plugin becomes ready, every `metrics.intervalMs` in persistent mode, and once more during graceful shutdown. Event `include` and `exclude` patterns affect logs only.

By default, destination logs replay from the controller's retained canonical file; `logStorage: { type: 'memory' }` opts out. Each replayed record keeps its original timestamp and resource snapshot. Metrics are never backfilled from that file; after restart they reflect only the new process.

Metrics report what this process observed. A missing metric can mean a plugin is absent, its state is unavailable, or a configured entity has not been observed yet. Metrics do not describe desired applications, expected machines, or overall health.

## Attribute scopes

Every metric batch carries the plugin's resource attributes, including the runtime-managed `service.name` and `service.instance.id`. The attributes in the tables below belong to individual metric points; resource attributes are not copied into them.

Plugins define their own primitive point attributes. `service.name` and `service.instance.id` are reserved on metric points to avoid conflicts with the resource identity. Other resource keys are not reserved there.

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

The `_total` observations are process-local gauges of current counters, not durable OTLP sums. Parked or unavailable file-source status appears in the observability plugin's destination state and in controller diagnostics. The loss total increases only when the exact count is known; otherwise the unknown-gap total increases.

## Content

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_content_source_state` | — | `source`, `state` | One-hot current state: `pending`, `fetching`, `success`, or `error` |
| `launchpad_content_source_last_success_seconds` | `s` | `source` | Recorded successful fetch completion as Unix seconds |
| `launchpad_content_active_version_promoted_seconds` | `s` | — | Recorded active-version promotion as Unix seconds |
| `launchpad_content_retained_versions` | — | — | Retained count from the latest retention sweep |
| `launchpad_content_pending_delete_versions` | — | — | Pending-delete count from the latest retention sweep |

Only configured sources with state are emitted. `launchpad_content_source_last_success_seconds` appears after the first successful fetch and persists through later fetching or error states in the same process. That history lives in memory and resets on restart. The active-version promotion timestamp appears only when retention state exists. These timestamps do not establish overall content freshness, and there is no `generatedAt` metric.

## Monitor

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_monitor_connected` | — | — | `1` when the monitor is currently connected to its process manager, otherwise `0` |
| `launchpad_monitor_app_status` | — | `app`, `status` | One-hot observed status: `online`, `offline`, or `errored` |

Only configured apps with current monitor state are emitted. The status reflects the monitor's current observation. It does not report authoritative readiness, crash history, or an inventory of expected apps.

## Scheduler

| Name | Unit | Attributes | Meaning |
|---|---|---|---|
| `launchpad_scheduler_job_running` | — | `job` | `1` while a dispatch is in flight |
| `launchpad_scheduler_job_overlap_skips` | — | `job` | Current process count of overlap skips |
| `launchpad_scheduler_job_retry_attempt` | — | `job` | Current consecutive failed-attempt count |
| `launchpad_scheduler_job_last_success_seconds` | `s` | `job` | Latest successful completion as Unix seconds; omitted until present |
| `launchpad_scheduler_job_last_outcome` | — | `job`, `outcome` | One-hot latest outcome: `success`, `overlapSkip`, or `failure`; omitted until present |

Only configured jobs with scheduler state are emitted. Every scheduler observation is a gauge of state held by this process; the scheduler exposes no monotonic counters.

## Custom plugin observations

Plugins provide gauges through their `observe(state)` hook. Names must begin with a letter and contain only letters, digits, `_`, `.`, or `-`; values must be finite. Launchpad bounds names, descriptions, and primitive attributes before delivery. Invalid observations are dropped so they cannot break the collection cycle.

Launchpad does not export traces, histograms, percentiles, or process CPU and memory measurements. File-backed logs do not change this signal set.
