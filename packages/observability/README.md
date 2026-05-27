# @bluecadet/launchpad-observability

Forwards launchpad logs and lifecycle events to external log aggregation backends. Built-in support for Grafana Loki; extensible with custom transports.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad/reference/observability>

## Features

- Forward `log:*` events and lifecycle events to any backend
- Built-in Grafana Loki transport with basic/bearer auth
- Configurable include/exclude filtering with glob wildcards
- Batched delivery with exponential backoff retries
- Implement `ObservabilityTransport` for custom backends

## Installation

```bash
npm install @bluecadet/launchpad
```

## Basic Usage

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
          defaultLabels: { app: 'my-installation' },
        }),
      ],
    }),
  ],
});
```

## License

ISC
