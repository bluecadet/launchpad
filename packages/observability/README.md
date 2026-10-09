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
          token: process.env.LAUNCHPAD_OBSERVABILITY_TOKEN || undefined,
        }),
      ],
      // Optional: use the controller's retained canonical log and checkpoints.
      logStorage: { type: 'file' },
    }),
  ],
});
```

`resource` is an optional flat record of string, finite number, and boolean attributes. Launchpad defaults `service.name` to `launchpad` and generates `service.instance.id` at runtime. Other attributes are caller-defined.

The OTLP destination uses native `fetch` and sends logs and metrics to `/v1/logs` and `/v1/metrics`. The example selects binary OTLP/HTTP protobuf, not gRPC; the recipient must support that encoding. Omit `encoding` to use the default JSON encoding. JSON requests and responses use `Content-Type: application/json`, while protobuf requests and responses use `Content-Type: application/x-protobuf`. Both encodings use the same endpoint paths, authentication, batching, resources, partial-success handling, and retries. Selecting an encoding does not enable payload compression or configure global OpenTelemetry providers.

The destination defaults to both signals. Metrics default to a 30-second observation interval and are independent of log event filters.

No telemetry is sent to Bluecadet automatically. When `logStorage` is omitted, logs use bounded in-memory queues. `{ type: 'file' }` opts destinations into the controller's retained canonical JSONL and atomic checkpoints, preserving original timestamps and resource snapshots across replay. It is not exactly once or lossless: ambiguous acknowledgements can duplicate records, and retention, disk failures, or backend rejection can lose them. Metrics remain latest-state in-memory snapshots. Review application logs and destination retention before enabling export; key-based redaction cannot detect every secret.

## Loki

Use `createLokiDestination` from `@bluecadet/launchpad-observability/destinations/loki` for structured, versioned JSON log lines. It maps only `service.name` to the `service_name` stream label by default; configure `resourceLabels` to replace that map. Use `createLokiTransport` from `@bluecadet/launchpad-observability/transports/loki` to preserve the legacy plain-text format.

Destination mode and legacy `{ transports }` mode cannot be combined in one plugin configuration.

## License

ISC
