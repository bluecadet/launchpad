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
| `resourceLabels` | `Record<string, string>` | `{ 'service.name': 'service_name' }` | Map resource attribute keys to Loki stream label names |

The omitted `resourceLabels` option promotes only `service.name` to `service_name`. Supplying a map replaces that default rather than extending it, so `resourceLabels: {}` disables all resource-derived labels.

The destination always manages the `level`, `module`, and `event` labels; those label names cannot be targets in `resourceLabels`. An own `__proto__` mapping key is also rejected. A mapped attribute that is missing is omitted. Boolean `false`, numeric `0`, and other present primitive values are stringified rather than omitted. Organization fields and custom resource attributes are never promoted automatically.

Every resource attribute remains available in the structured log line's `resource` object, whether or not it is mapped to a stream label. Each line also contains `schemaVersion: 1`, timestamp, event, level, message, optional module, and normalized metadata. Unsupported JSON values and circular references are represented safely, and oversized structures are truncated. Sensitive-key redaction is only a safeguard; read [Privacy and delivery limits](../privacy.md).

## Bluecadet fleet label recipe

The following is an optional deployment policy for fleets that use Bluecadet's canonical resource keys. These fields are not required by the public observability model.

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
      url: 'https://loki.example.com',
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

This explicit map preserves the previous fleet's `client`, `project`, `installation`, `environment`, and `service_name` Loki label contract. When the same resource is exported as OTLP metrics, Grafana metric filters depend on the existing collector's resource-to-label mapping; Launchpad does not promote OTLP resource attributes to metric-point attributes.

## Legacy plain-text format

`createLokiTransport()` remains available from `@bluecadet/launchpad/observability/transports/loki`. It emits the existing plain-text line format and supports its existing options. New and legacy formats are intentionally separate; see the [migration guide](../migration.md).
