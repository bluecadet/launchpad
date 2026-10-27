---
title: "Migrate observability APIs and transports"
---

These notes cover upgrading to controller 4 and observability 4 through `@bluecadet/launchpad` 4. The umbrella package also takes a major release because its re-exported APIs have breaking changes. See [Versioning and upgrades](../../guides/packages.md#versioning-and-upgrades) for the independent package policy.

## API changes when upgrading

These TypeScript changes apply even if you keep legacy transports.

### Copy log entries when enriching them

`LogEntry` fields are now readonly. Custom transports and helpers that assign to fields such as `entry.module` or `entry.metadata` must create a new entry. Copy metadata too when enriching it so other consumers do not see your changes:

```typescript
import type { LogEntry } from '@bluecadet/launchpad/observability';

function enrichEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    module: entry.module ?? 'installation',
    metadata: { ...entry.metadata, installation: 'lobby-kiosk' },
  };
}
```

Pass the returned entry to your exporter instead of mutating the original. Readonly fields do not make nested metadata immutable.

### Type transport-only helpers explicitly

`ObservabilityConfig` is now a union of legacy transport and destination configurations, so `transports` may be absent. Type helpers that accept only transport configurations as `LegacyObservabilityConfig`:

```typescript
import type { LegacyObservabilityConfig } from '@bluecadet/launchpad/observability';

function getTransports(config: LegacyObservabilityConfig) {
  return config.transports;
}
```

If a helper accepts both modes, keep `ObservabilityConfig` and narrow before reading transports, for example with `if (config.transports !== undefined)`.

## Optional migration to destinations

Existing `transports` configurations still work and keep their in-memory delivery; the destination defaults below do not affect them. Switch modes when you need structured Loki records, OTLP, resource attributes, gauges, or checkpointed file delivery.

### 1. Record the current filters and labels

Existing `include`, `exclude`, `batch`, and `buffer` options carry over to destination mode. Default file delivery filters only canonical records captured by the controller, not every raw custom bus event. If your filters rely on custom live-bus events, select memory delivery as described below. List every legacy Loki label that queries, dashboards, or alerts depend on. Resource attributes are optional and caller-defined, so preserving an existing label contract requires an explicit `resourceLabels` map.

### 2. Replace the transport

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

This resource shape and label map are an optional fleet policy, not required fields. Omit `resource` when the runtime defaults for `service.name` and `service.instance.id` suffice.

Remove `transports` from the new configuration. The two modes are mutually exclusive, and a mixed configuration fails validation. `logStorage` is also destination-only; adding `{ type: 'file' }` or `{ type: 'memory' }` to a legacy transport configuration fails validation.

### 3. Check query and ingestion behavior

`createLokiTransport()` still emits legacy plain-text lines. `createLokiDestination()` emits versioned structured JSON with normalized metadata. Update parsers and queries that assume the old line format before switching production traffic.

When `resourceLabels` is omitted, the destination maps only `service.name` to `service_name`. A supplied map replaces that default instead of extending it. Missing resource attributes are omitted from labels; present booleans and numbers are stringified. Every structured log line contains all resource attributes regardless of label mapping.

Review selectors in a non-production stream. This release has fixture coverage but has not been validated against a live Loki or OpenTelemetry backend. For OTLP metrics, queryable Grafana labels also depend on the collector's resource-to-label mapping.

### 4. Review default file delivery

Destination mode now reads the controller's retained canonical JSONL and keeps a checkpoint per destination. Omitting `logStorage` is equivalent to `{ type: 'file' }`. Set memory delivery for custom exporters without replay support, custom live-bus events missing from the canonical source, tests without a file source, or ephemeral delivery:

```typescript
observability({
  destinations: [createLokiDestination({ url: 'http://localhost:3100' })],
  logStorage: { type: 'memory' },
});
```

A new destination starts at the oldest retained canonical record, so enabling one can backfill historical data, raise ingestion costs, and hit backend timestamp limits. Restarting with the same destination name, checkpoint key, and controller source resumes from the existing checkpoint. A lost acknowledgement can duplicate records, and bounded retention can expire unread records. File delivery does not read the old text files or create a separate spool, and needs no Alloy or other sidecar.

Memory delivery does not advance file checkpoints. Switching back to file delivery resumes from the existing checkpoint, or from the oldest retained record if none exists, so records already sent from memory may be exported again.

Custom log exporters must provide a stable `checkpointKey` and implement `exportCanonical(batch, context)` using the batch's normalized records and historical resource snapshot, or opt out with memory delivery. An unavailable canonical source never falls back to memory. See [custom destinations](./custom-destinations.md#file-delivery-support) and [delivery limits](./privacy.md#delivery-is-bounded-not-exactly-once).

The controller's file layout changed from overlapping Winston streams (`launchpad-info`, `launchpad-debug`, and `launchpad-error`) to segmented canonical JSONL plus one optional, default-on human-readable text stream at `info` and above. Existing files are neither migrated nor deleted. Update file-tail tools, backup rules, and cleanup scripts that depend on the old names or assume one file per severity. The text format is for people and may use the legacy custom formatter; the canonical JSONL schema is fixed and is the machine-readable contract.

The controller now applies one rotation and retention policy to both outputs. Directory and custom text format options remain supported. `maxSize` accepts byte sizes of at least 1,024 bytes, such as `8m`; invalid or smaller sizes fail configuration validation. The default segment target changes from `20m` to `8m`. `maxFiles` accepts positive day-based ages such as `28d`; count-based and non-day values now fail validation, so replace them before upgrading. A nondefault `datePattern` is accepted but ignored with one deprecation warning; the default `YYYY-MM-DD` does not warn. Review the [controller logging reference](/reference/controller/logging/) before rollout.

### 5. Decide whether to export metrics

`include` and `exclude` do not affect metrics, which default to a 30-second interval. Use `metrics: false` for a logs-only migration:

```typescript
observability({
  destinations: [createLokiDestination({ url: 'http://localhost:3100' })],
  metrics: false,
});
```

Loki is logs-only; use an OTLP destination for gauges.

File-backed delivery applies only to logs. Metrics remain latest, coalesced in-memory snapshots, with no history backfilled after downtime.

### 6. Keep the old mode available during rollout

Change one configuration mode at a time, and never configure both modes in one plugin. Legacy transport mode remains available, so rolling back to transports needs no package version change. Custom transport code still needs the TypeScript updates above.
