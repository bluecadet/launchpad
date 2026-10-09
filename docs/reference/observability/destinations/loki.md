---
title: "Loki Destination"
---

`createLokiDestination()` exports structured, versioned JSON log records to Grafana Loki. Loki is logs-only; use [OTLP](./otlp.md) for metrics.

```typescript
import { createLokiDestination } from '@bluecadet/launchpad/observability/destinations/loki';

const token = process.env.LOKI_TOKEN;

const destination = createLokiDestination({
  name: 'operations-loki',
  url: 'https://loki.example.com',
  auth: token ? { type: 'bearer', token } : undefined,
  headers: {
    'X-Scope-OrgID': 'museum',
  },
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `url` | `string` | Required | Loki base URL; `/loki/api/v1/push` is appended |
| `name` | `string` | `'loki'` | Destination name used in diagnostics |
| `auth` | `{ type: 'bearer'; token: string } \| { type: 'basic'; username: string; password: string }` | — | Request authentication |
| `headers` | `Record<string, string>` | — | Additional proxy, gateway, or tenant headers |

Loki stream labels are deliberately bounded to `level`, canonical deployment identity, optional logger `module`, and the event name for lifecycle events. Custom deployment attributes remain in the structured line's `resource` object but do not become labels.

Each line contains `schemaVersion: 1`, timestamp, event, level, message, optional module, normalized metadata, and resource attributes. Unsupported JSON values and circular references are represented safely, and oversized structures are truncated. Sensitive-key redaction is only a safeguard; read [Privacy and delivery limits](../privacy.md).

## Legacy plain-text format

`createLokiTransport()` remains available from `@bluecadet/launchpad/observability/transports/loki`. It emits the existing plain-text line format and supports its existing options. New and legacy formats are intentionally separate; see the [migration guide](../migration.md).
