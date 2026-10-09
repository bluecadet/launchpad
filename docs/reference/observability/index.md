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

This setup sends logs and periodic gauges as binary OTLP/HTTP protobuf, not gRPC. The recipient must support the selected encoding. Omit `encoding` to use the default OTLP/HTTP JSON encoding. `resource` is optional; Launchpad always supplies `service.name` and a runtime-generated `service.instance.id`. No telemetry is sent to Bluecadet automatically. Use [`signals`](./signals.md) to review each built-in observation before enabling export.

## Choose a destination

| Destination | Signals | Use it when |
|---|---|---|
| [OTLP/HTTP](./destinations/otlp.md) | Logs and metrics | Your collector or vendor accepts OTLP JSON or protobuf over HTTP |
| [Loki](./destinations/loki.md) | Logs only | You send logs directly to Grafana Loki |
| [Custom](./custom-destinations.md) | Logs, metrics, or both | You need another protocol or backend |

Traces, histograms, and percentiles are not implemented. A destination that requests an unsupported signal fails configuration validation rather than silently ignoring it.

## How collection works

Log selection uses `include` and `exclude`; the default is `include: ['log:*']`. Metric collection is independent of those event filters. Every observation cycle asks the controller and registered plugins for bounded gauges derived from their current state.

Gauges describe the state observed at collection time. They are not health checks, desired state, or evidence that every expected machine or app exists. In particular, Launchpad does not export an overall content-freshness or generated-at guarantee.

Delivery is best effort. Queues are bounded in memory, requests have deadlines, and shutdown has a separate deadline. A process exit, full queue, expired deadline, or permanently rejected record can lose telemetry. Configure durable buffering in the collector when delivery guarantees matter.

## Next steps

- [Configuration](./observability-config.md)
- [Signal catalog](./signals.md)
- [Custom destinations](./custom-destinations.md)
- [Migrate from transports](./migration.md)
- [Privacy and delivery limits](./privacy.md)
