---
title: "Migrate from Observability Transports"
---

The legacy `transports` mode remains available. Migrate when you need structured Loki records, OTLP, optional resource attributes, gauges, or checkpointed file delivery.

## 1. Record the current filters and labels

Existing `include`, `exclude`, `batch`, and `buffer` options can be carried into destination mode. Record every legacy Loki label that queries, dashboards, or alerts depend on. Resource attributes are optional and caller-defined; preserving an existing label contract requires an explicit `resourceLabels` map.

## 2. Replace the transport

Before:

```typescript
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiTransport } from '@bluecadet/launchpad/observability/transports/loki';

observability({
  transports: [
    createLokiTransport({
      url: 'http://localhost:3100',
      defaultLabels: {
        client: 'museum',
        project: 'west-wing',
        installation: 'lobby-kiosk',
        environment: 'production',
        service_name: 'launchpad',
      },
    }),
  ],
});
```

After:

```typescript
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiDestination } from '@bluecadet/launchpad/observability/destinations/loki';

observability({
  resource: {
    'service.name': 'launchpad',
    'launchpad.client': 'museum',
    'launchpad.project': 'west-wing',
    'launchpad.installation': 'lobby-kiosk',
    'deployment.environment.name': 'production',
  },
  destinations: [
    createLokiDestination({
      url: 'http://localhost:3100',
      auth: process.env.LOKI_TOKEN
        ? { type: 'bearer', token: process.env.LOKI_TOKEN }
        : undefined,
      resourceLabels: {
        'launchpad.client': 'client',
        'launchpad.project': 'project',
        'launchpad.installation': 'installation',
        'deployment.environment.name': 'environment',
        'service.name': 'service_name',
      },
    }),
  ],
});
```

This resource shape and label map are an optional fleet policy, not required observability fields. Omit `resource` when the runtime defaults for `service.name` and `service.instance.id` are sufficient.

Do not leave `transports` in the new configuration. The two modes are mutually exclusive and mixed configuration fails validation. `logStorage` is also destination-only; adding it to a legacy transport configuration fails validation.

## 3. Check query and ingestion behavior

`createLokiTransport()` continues to emit legacy plain-text lines. `createLokiDestination()` emits versioned structured JSON and preserves safely normalized metadata. Update parsers and queries that assume the old line format before switching production traffic.

When `resourceLabels` is omitted, the destination maps only `service.name` to `service_name`. A supplied map replaces that default; it does not extend it. Missing resource attributes are omitted from labels, while present booleans and numbers are stringified. All resource attributes remain in each structured log line regardless of label mapping.

Review selectors in a non-production stream. This release has fixture coverage but does not claim validation against a live Loki or OpenTelemetry backend. For OTLP metrics, queryable Grafana labels also depend on the collector's resource-to-label mapping.

## 4. Decide whether to enable file delivery

Destination mode keeps the existing in-memory log path unless you opt in:

```typescript
observability({
  destinations: [createLokiDestination({ url: 'http://localhost:3100' })],
  logStorage: { type: 'file' },
});
```

This uses the controller's canonical JSONL log as the delivery source and stores an independent checkpoint for each destination. Enrollment begins at the oldest canonical record still retained. It does not read the old text files or create a separate observability spool.

The controller's file layout has changed from three overlapping Winston streams (`launchpad-info`, `launchpad-debug`, and `launchpad-error`) to segmented canonical JSONL plus one optional human-readable text stream. Existing files are neither migrated nor deleted. Update file-tail tools, backup rules, and cleanup scripts that depend on the old names or assume one file per severity. The text format is for people and may use the legacy custom formatter; the canonical JSONL schema is fixed and is the machine-readable contract.

The controller now owns one rotation and retention policy for both outputs. Directory and custom text format options remain supported. `maxSize` accepts positive byte sizes such as `8m`; invalid sizes fail configuration validation. The default segment target changes from `20m` to `8m`. `maxFiles` accepts positive day-based ages such as `28d`; count-based and non-day retention values now fail validation and must be replaced before upgrading. A nondefault `datePattern` is accepted but ignored with one deprecation warning; the default `YYYY-MM-DD` does not warn. Review the [controller logging reference](../controller/logging.md) before rollout.

## 5. Decide whether to export metrics

Metrics are independent of `include` and `exclude` and default to a 30-second interval. Use `metrics: false` for a logs-only migration:

```typescript
observability({
  destinations: [createLokiDestination({ url: 'http://localhost:3100' })],
  metrics: false,
});
```

Loki is logs-only, so use an OTLP destination when gauges are required.

File-backed delivery applies only to logs. Metrics continue to be latest-state in-memory snapshots; enabling file delivery does not backfill metric history after downtime.

## 6. Keep the old mode available during rollout

Change one configuration mode at a time; do not configure both in one plugin. The legacy transport API is retained unchanged for compatibility, so rollback does not require changing the installed package version.
