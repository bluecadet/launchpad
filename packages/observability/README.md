# @bluecadet/launchpad-observability

Exports Launchpad logs and current-state gauges to endpoints you control. Built-in destinations support OTLP/HTTP JSON and Grafana Loki; the legacy transport API remains available.

## Documentation

See the [observability documentation](https://launchpad.bluecadet.com/reference/observability/) for configuration, the signal catalog, privacy limits, delivery semantics, and migration guidance.

## Installation

```bash
npm install @bluecadet/launchpad
```

## OTLP quick start

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { observability } from '@bluecadet/launchpad/observability';
import { createOtlpDestination } from '@bluecadet/launchpad/observability/destinations/otlp';

const endpoint = process.env.LAUNCHPAD_OBSERVABILITY_ENDPOINT;
if (!endpoint) throw new Error('LAUNCHPAD_OBSERVABILITY_ENDPOINT is required');

export default defineConfig({
  plugins: [
    observability({
      deployment: {
        client: 'museum',
        project: 'west-wing',
        installation: 'lobby-kiosk',
        environment: 'production',
      },
      destinations: [
        createOtlpDestination({
          endpoint,
          token: process.env.LAUNCHPAD_OBSERVABILITY_TOKEN,
        }),
      ],
    }),
  ],
});
```

The OTLP destination uses native `fetch`, sends JSON to `/v1/logs` and `/v1/metrics`, and defaults to both signals. Metrics default to a 30-second observation interval and are independent of log event filters.

No telemetry is sent to Bluecadet automatically. Delivery is bounded and best effort: queues are in memory, requests and shutdown have deadlines, and records can be dropped. Review application logs and destination retention before enabling export; key-based redaction cannot detect every secret.

## Loki

Use `createLokiDestination` from `@bluecadet/launchpad-observability/destinations/loki` for structured, versioned JSON log lines. Use `createLokiTransport` from `@bluecadet/launchpad-observability/transports/loki` to preserve the legacy plain-text format.

Destination mode and legacy `{ transports }` mode cannot be combined in one plugin configuration.

## License

ISC
