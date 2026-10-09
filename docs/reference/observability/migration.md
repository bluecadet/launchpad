---
title: "Migrate from Observability Transports"
---

The legacy `transports` mode remains available. Migrate when you need structured Loki records, OTLP, deployment resources, or gauges.

## 1. Record the current filters and labels

Existing `include`, `exclude`, `batch`, and `buffer` options can be carried into destination mode. Convert stable Loki labels into the required deployment identity or `deployment.attributes`.

## 2. Replace the transport

Before:

```typescript
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiTransport } from '@bluecadet/launchpad/observability/transports/loki';

observability({
  transports: [
    createLokiTransport({
      url: 'http://localhost:3100',
      defaultLabels: { installation: 'lobby-kiosk' },
    }),
  ],
});
```

After:

```typescript
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiDestination } from '@bluecadet/launchpad/observability/destinations/loki';

observability({
  deployment: {
    client: 'museum',
    project: 'west-wing',
    installation: 'lobby-kiosk',
    environment: 'production',
  },
  destinations: [
    createLokiDestination({
      url: 'http://localhost:3100',
      auth: process.env.LOKI_TOKEN
        ? { type: 'bearer', token: process.env.LOKI_TOKEN }
        : undefined,
    }),
  ],
});
```

Do not leave `transports` in the new configuration. The two modes are mutually exclusive and mixed configuration fails validation.

## 3. Check query and ingestion behavior

`createLokiTransport()` continues to emit legacy plain-text lines. `createLokiDestination()` emits versioned structured JSON and preserves safely normalized metadata. Update parsers and queries that assume the old line format before switching production traffic.

The new destination derives a bounded set of stream labels from the canonical deployment identity. Custom deployment attributes stay in each structured line's resource object. Review selectors in a non-production stream.

## 4. Decide whether to export metrics

Metrics are independent of `include` and `exclude` and default to a 30-second interval. Use `metrics: false` for a logs-only migration:

```typescript
observability({
  deployment: { /* ... */ },
  destinations: [createLokiDestination({ url: 'http://localhost:3100' })],
  metrics: false,
});
```

Loki is logs-only, so use an OTLP destination when gauges are required.

## 5. Keep the old mode available during rollout

Change one configuration mode at a time; do not configure both in one plugin. The legacy transport API is retained for compatibility, so rollback does not require changing the installed package version.
