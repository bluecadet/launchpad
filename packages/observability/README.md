# @bluecadet/launchpad-observability

Exports Launchpad logs and current-state gauges to endpoints you control. Built-in destinations support OTLP/HTTP JSON or protobuf and Grafana Loki; the legacy transport API remains available.

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
      // Optional. Omit resource to use service.name = 'launchpad'.
      resource: { 'service.name': 'museum-kiosk' },
      destinations: [
        createOtlpDestination({
          endpoint,
          encoding: 'protobuf',
          token: process.env.LAUNCHPAD_OBSERVABILITY_TOKEN,
        }),
      ],
    }),
  ],
});
```

`resource` is an optional flat record of string, finite number, and boolean attributes. Launchpad defaults `service.name` to `launchpad` and generates `service.instance.id` at runtime. Other attributes are caller-defined.

The OTLP destination uses native `fetch` and sends logs to `/v1/logs` and metrics to `/v1/metrics`. The example selects binary OTLP/HTTP protobuf, not gRPC, so the recipient must support that encoding. Omit `encoding` to use the default, JSON. JSON requests and responses use `Content-Type: application/json`; protobuf uses `Content-Type: application/x-protobuf`. Otherwise the encodings behave identically: same endpoint paths, authentication, batching, resources, partial-success handling, and retries. Selecting an encoding neither compresses payloads nor configures global OpenTelemetry providers.

The destination sends both signals by default. Metrics default to a 30-second observation interval and ignore log event filters.

Launchpad sends no telemetry to Bluecadet. By default, configured destinations read the controller's retained canonical JSONL and keep atomic checkpoints, so replay preserves original timestamps and resource snapshots. A new destination backfills from the oldest retained record, which can raise ingestion costs or trigger backend timestamp rejection. Set `logStorage: { type: 'memory' }` for ephemeral delivery or for custom exporters without replay support.

File delivery captures canonical records, not every raw custom bus event, and never falls back to memory when the source is unavailable. Delivery is neither exactly once nor lossless: ambiguous acknowledgements can duplicate records, and retention, disk failures, or backend rejection can lose them. Metrics remain latest-state in-memory snapshots.

Review application logs and destination retention before enabling export; key-based redaction cannot detect every secret.

## Loki

`createLokiDestination` from `@bluecadet/launchpad-observability/destinations/loki` sends structured, versioned JSON log lines. By default it maps only `service.name` to the `service_name` stream label; set `resourceLabels` to replace that map. To keep the legacy plain-text format, use `createLokiTransport` from `@bluecadet/launchpad-observability/transports/loki`.

One plugin configuration cannot combine destination mode with legacy `{ transports }` mode.

## License

ISC
