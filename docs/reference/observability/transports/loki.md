---
title: "Loki transport"
---
The Loki transport delivers legacy plain-text log batches to [Grafana Loki](https://grafana.com/oss/loki/) through its HTTP push API (`/loki/api/v1/push`). It remains for compatibility. New deployments should use the [structured Loki destination](../destinations/loki.md); read the [migration guide](../migration.md) before switching an existing stream.

## Usage

```typescript
import { observability } from '@bluecadet/launchpad/observability';
import { createLokiTransport } from '@bluecadet/launchpad/observability/transports/loki'; // [!code highlight]

export default defineConfig({
  plugins: [
    observability({
      transports: [
        createLokiTransport({ // [!code highlight]
          url: 'http://loki:3100', // [!code highlight]
          defaultLabels: { app: 'my-installation', env: 'production' }, // [!code highlight]
        }), // [!code highlight]
      ],
    }),
  ],
});
```

## Options

### `url`

**Type:** `string`  
**Required:** Yes

Base URL of the Loki instance, without a trailing slash. The transport appends `/loki/api/v1/push`.

```typescript
createLokiTransport({ url: 'http://loki:3100' })
createLokiTransport({ url: 'https://logs-prod-us-central1.grafana.net' })
```

### `defaultLabels`

**Type:** `Record<string, string>`  
**Default:** `{}`

Static labels applied to every log stream from this transport. Loki indexes and filters logs by label, so keep cardinality low with stable values such as app name, environment, and location.

```typescript
createLokiTransport({
  url: 'http://loki:3100',
  defaultLabels: {
    app: 'lobby-kiosk',
    env: 'production',
    location: 'floor-2',
  },
})
```

> [!NOTE]
> The transport adds `level` and `module` labels to streams from `log:*` events, and `level: "event"` plus an `event` label for lifecycle events. Use `defaultLabels` only for stable, low-cardinality identifiers.

### `auth`

**Type:** `{ type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string }`  
**Default:** None (no authentication)

Authentication for Loki endpoints that require it. Grafana Cloud uses basic auth with your user ID as the username and an API token as the password.

```typescript
// Grafana Cloud
createLokiTransport({
  url: 'https://logs-prod-us-central1.grafana.net',
  auth: {
    type: 'basic',
    username: '123456',
    password: 'glc_...',
  },
})

// Self-hosted with bearer token
createLokiTransport({
  url: 'http://loki:3100',
  auth: {
    type: 'bearer',
    token: 'my-secret-token',
  },
})
```

### `headers`

**Type:** `Record<string, string>`  
**Default:** `{}`

Additional HTTP headers sent with every push request, for proxies, API gateways, or custom authentication schemes.

```typescript
createLokiTransport({
  url: 'http://loki-proxy:8080',
  headers: {
    'X-Scope-OrgID': 'my-tenant',
  },
})
```

## Stream label schema

The transport groups log entries into streams by label set. Entries with identical labels share a stream.

| Event type | Labels |
|---|---|
| `log:info`, `log:warn`, etc. | `defaultLabels` + `level: "info"` + `module: "..."` (if present) |
| Any other event (lifecycle, commands, etc.) | `defaultLabels` + `level: "event"` + `event: "monitor:app:crash"` |

Keep `defaultLabels` small and stable (app, env, location) to limit the number of streams.
