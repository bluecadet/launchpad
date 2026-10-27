---
title: "Observability"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/observability) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-observability) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/observability/CHANGELOG.md)

The observability plugin exports structured logs and current-state gauges to endpoints you control. Launchpad does not provide a collector, storage service, fleet inventory, or dashboard.

## Quick start: OTLP/HTTP

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { observability } from '@bluecadet/launchpad/observability';
import { createOtlpDestination } from '@bluecadet/launchpad/observability/destinations/otlp';

const endpoint = process.env.LAUNCHPAD_OBSERVABILITY_ENDPOINT;
const token = process.env.LAUNCHPAD_OBSERVABILITY_TOKEN || undefined;

if (!endpoint) {
  throw new Error('LAUNCHPAD_OBSERVABILITY_ENDPOINT is required');
}

export default defineConfig({
  plugins: [
    observability({
      // Optional. Omit resource to use service.name = 'launchpad'.
      resource: { 'service.name': 'museum-kiosk' },
      destinations: [createOtlpDestination({ endpoint, encoding: 'protobuf', token })],
    }),
  ],
});
```

This setup sends logs and periodic gauges as binary OTLP/HTTP protobuf, not gRPC. The recipient must support the selected encoding; omit `encoding` to use OTLP/HTTP JSON. Launchpad always supplies `service.name` and a runtime-generated `service.instance.id`, so `resource` is optional. Launchpad sends no telemetry to Bluecadet. Review each built-in observation in [`signals`](./signals.md) before enabling export.

## Choose a destination

| Destination | Signals | Use it when |
|---|---|---|
| [OTLP/HTTP](./destinations/otlp.md) | Logs and metrics | Your collector or vendor accepts OTLP JSON or protobuf over HTTP |
| [Loki](./destinations/loki.md) | Logs only | You send logs directly to Grafana Loki |
| [Custom](./custom-destinations.md) | Logs, metrics, or both | You need another protocol or backend |

Traces, histograms, and percentiles are not implemented. A destination that requests an unsupported signal fails configuration validation.

## How collection works

`include` and `exclude` select logs; the default is `include: ['log:*']`. These event filters do not affect metrics. Each observation cycle asks the controller and registered plugins for bounded gauges derived from their current state.

Gauges describe the state observed at collection time. They are not health checks, desired state, or evidence that every expected machine or app exists. Launchpad exports no overall content-freshness or generated-at guarantee.

By default, destinations deliver logs from the controller-owned canonical JSONL with a durable checkpoint per destination. A new destination backfills from the oldest retained record, which can raise ingestion costs or hit backend timestamp limits. Set `logStorage: { type: 'memory' }` for ephemeral delivery or for custom exporters without replay support. The default source holds canonical records only, not every raw custom bus event, and event filters cannot recover events the controller did not record. An unavailable file source does not fall back to memory. File delivery replays retained logs after restart, but retention, disk failures, backend rejection, and ambiguous acknowledgements still rule out exactly-once or lossless delivery. Metrics stay latest-state in-memory snapshots.

## Next steps

- [Configuration](/reference/observability/observability-config/)
- [Signal catalog](./signals.md)
- [Custom destinations](./custom-destinations.md)
- [Migrate from transports](./migration.md)
- [Privacy and delivery limits](./privacy.md)
