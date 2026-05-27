---
title: "@bluecadet/launchpad-observability"
---

<script setup>
  import PackageHeader from '../../components/PackageHeader.vue'
</script>

<PackageHeader package="observability" />

The observability package forwards launchpad logs and lifecycle events to external log aggregation backends. It captures events from the controller event bus, normalizes them into structured log entries, and delivers them in batches to one or more configurable transports.

## Features

- **Log forwarding**: Captures all `log:*` events — info, warn, error, debug, verbose — with module scoping preserved
- **Lifecycle events**: Forwards command, workflow, monitor, and system events alongside logs for full operational visibility
- **Grafana Loki transport**: Built-in HTTP push transport with stream label grouping, basic/bearer auth, and custom header support
- **Configurable filtering**: Include/exclude events by name pattern with glob wildcard support (e.g. `log:*`, `monitor:app:*`)
- **Resilient delivery**: Batched delivery with exponential backoff retries and a bounded in-memory buffer — data survives transient outages
- **Custom transports**: Implement the `ObservabilityTransport` interface to send logs to any backend (Datadog, OpenTelemetry, Elasticsearch, etc.)

## Installation

```bash
npm install @bluecadet/launchpad
```

## JS API Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiTransport } from '@bluecadet/launchpad/observability/transports/loki';

export default defineConfig({
  plugins: [
    observability({
      transports: [
        createLokiTransport({
          url: 'http://loki:3100',
          defaultLabels: {
            app: 'my-installation',
            env: 'production',
          },
        }),
      ],
    }),
  ],
});
```

## Configuration

Observability is configured through an `ObservabilityConfig` object:

- **transports**: Array of transport instances to send logs to
- **include / exclude**: Event name patterns controlling which events are forwarded
- **batch**: Flush interval and maximum batch size
- **buffer**: Retry count and in-memory buffer cap for failed batches

See the [Observability Config](./observability-config) section for all options.

## Error Handling

The package uses `neverthrow` for reliable error handling. Push failures are retried with exponential backoff and emitted as `observability:push:error` events. When the retry buffer fills up, the oldest batches are dropped and `observability:push:dropped` is emitted. See [Events](./events) for the full event reference.

## Custom Transports

Any backend can be supported by implementing `ObservabilityTransport`:

```typescript
import type { ObservabilityTransport } from '@bluecadet/launchpad/observability';

const myTransport: ObservabilityTransport = {
  name: 'my-backend',
  push(batch) {
    // send batch to your backend
    return ResultAsync.fromPromise(sendToBackend(batch), (e) => e as Error);
  },
};

observability({ transports: [myTransport] });
```

See [Transports](./transports/loki) for the built-in Loki transport.
