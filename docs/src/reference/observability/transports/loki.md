---
title: "Loki Transport"
---

# Loki Transport

The built-in Loki transport delivers log batches to [Grafana Loki](https://grafana.com/oss/loki/) via its HTTP push API (`/loki/api/v1/push`).

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

Base URL of the Loki instance. The push endpoint `/loki/api/v1/push` is appended automatically. Do not include a trailing slash.

```typescript
createLokiTransport({ url: 'http://loki:3100' })
createLokiTransport({ url: 'https://logs-prod-us-central1.grafana.net' })
```

### `defaultLabels`

**Type:** `Record<string, string>`  
**Default:** `{}`

Static label key-value pairs applied to every log stream from this transport. Labels are how Grafana Loki indexes and filters logs — keep cardinality low by using stable values like app name, environment, and location.

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

> [!NOTE] Dynamic labels from log entries
> The transport automatically adds `level` and `module` labels to log streams (from `log:*` events), and `level: "event"` plus `event` labels for lifecycle events. Only use `defaultLabels` for stable, low-cardinality identifiers.

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

Additional HTTP headers to include with every push request. Useful for proxies, API gateways, or custom authentication schemes.

```typescript
createLokiTransport({
  url: 'http://loki-proxy:8080',
  headers: {
    'X-Scope-OrgID': 'my-tenant',
  },
})
```

## Stream label schema

The Loki transport groups log entries into streams based on their labels. Two entries with identical label sets share a stream; entries with different labels get separate streams.

| Event type | Labels |
|---|---|
| `log:info`, `log:warn`, etc. | `defaultLabels` + `level: "info"` + `module: "..."` (if present) |
| Any other event (lifecycle, commands, etc.) | `defaultLabels` + `level: "event"` + `event: "monitor:app:crash"` |

Keep `defaultLabels` to a small, stable set (app, env, location) to avoid stream explosion.
