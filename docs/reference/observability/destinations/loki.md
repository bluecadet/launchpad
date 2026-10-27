---
title: "Loki destination"
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

The factory returns an inert destination definition. The observability plugin validates options when it calls `destination.create()` during setup; invalid options return a non-retryable `Err` instead of throwing while your config module loads. Neither the factory nor `create()` sends requests. If you call `create()` directly, handle its `Result`.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `url` | `string` | Required | Loki base URL; `/loki/api/v1/push` is appended |
| `name` | `string` | `'loki'` | Destination name used in diagnostics |
| `auth` | `{ type: 'bearer'; token: string } \| { type: 'basic'; username: string; password: string }` | — | Request authentication |
| `headers` | `Record<string, string>` | — | Additional proxy, gateway, or tenant headers |
| `resourceLabels` | `Record<string, string>` | `{ 'service.name': 'service_name' }` | Map resource attribute keys to Loki stream label names |

Header names are case-insensitive. The destination always sets `Content-Type: application/json`. When `auth` is supplied, its credentials override any custom `Authorization` header; without `auth`, a custom `Authorization` header is kept. Other custom headers, including tenant headers, are kept. Invalid header names or values return a configuration `Err` during setup.

When `resourceLabels` is omitted, only `service.name` is promoted to `service_name`. A supplied map replaces that default instead of extending it, so `resourceLabels: {}` disables all resource-derived labels.

The destination always manages the `level`, `module`, and `event` labels, so `resourceLabels` cannot target those names. An own `__proto__` mapping key is also rejected. A mapped attribute that is missing is omitted. Present primitive values, including `false` and `0`, are stringified. Organization fields and custom resource attributes are never promoted automatically.

Every resource attribute appears in the structured log line's `resource` object, whether or not it maps to a stream label. Each line also contains `schemaVersion: 1`, timestamp, event, level, message, optional module, and normalized metadata. Unsupported JSON values and circular references are encoded safely, and oversized structures are truncated. Sensitive-key redaction is only a safeguard; read [Privacy and delivery limits](../privacy.md).

With default file delivery, the destination derives its credential-free checkpoint key from the normalized Loki endpoint. Authentication, tenant headers, and label mapping do not affect the key. Changing only credentials preserves the checkpoint; changing the endpoint starts a new reader. Grafana gateways can serve multiple tenant accounts from one URL, so change the destination `name` when switching accounts. Replayed records keep their stored timestamps and resource snapshots; confirm that Loki accepts timestamps as old as the controller's retention window.

## Bluecadet fleet label recipe

An optional deployment policy for fleets that use Bluecadet's canonical resource keys. The observability plugin does not require these fields.

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

This map preserves the legacy `client`, `project`, `installation`, `environment`, and `service_name` Loki labels. When the same resource is exported as OTLP metrics, Grafana metric filters depend on the collector's resource-to-label mapping; Launchpad does not promote OTLP resource attributes to metric-point attributes.

## Legacy plain-text format

`createLokiTransport()` remains available from `@bluecadet/launchpad/observability/transports/loki` with its plain-text line format and existing options. See the [migration guide](../migration.md) to move between formats.
