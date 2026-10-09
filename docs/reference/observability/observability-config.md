---
title: "Observability Config"
---

`observability()` accepts destination mode or the legacy transport mode. Do not configure `destinations` and `transports` together.

## Destination mode

```typescript
observability({
  resource: {
    'service.name': 'museum-kiosk',
    'launchpad.client': 'museum',
    'launchpad.project': 'west-wing',
    'launchpad.installation': 'lobby-kiosk',
    'deployment.environment.name': 'production',
    region: 'us-east',
  },
  destinations: [destination],
  include: ['log:*'],
  exclude: [],
  metrics: { intervalMs: 30_000 },
  delivery: {
    deliveryTimeoutMs: 5_000,
    shutdownTimeoutMs: 3_000,
    maxQueuedBatches: 50,
  },
});
```

### `resource`

**Type:** `Readonly<Record<string, string | number | boolean>>`

**Required:** No

A flat set of resource attributes attached to every exported log and metric. Attribute names and meanings are caller-defined; Launchpad does not give special meaning to client, project, installation, organization, or environment attributes.

Launchpad supplies only these defaults:

| Resource attribute | Default | Configuration behavior |
|---|---|---|
| `service.name` | `'launchpad'` | May be replaced with a nonblank string |
| `service.instance.id` | A runtime-generated UUID | Runtime-owned; configuring it is rejected |

The runtime generates a new `service.instance.id` during each plugin setup. No other resource attributes are added automatically. The own key `__proto__` is rejected to prevent prototype-key data loss.

A resource can contain at most 64 configured attributes. Keys must be nonempty and at most 128 characters. String values are limited to 1,024 characters, and number values must be finite. Nested objects, arrays, `null`, and `undefined` are not supported.

Resource attributes and metric-point attributes are separate scopes. Resource attributes are attached to every signal but are not copied into each metric point. Metric points retain their own bounded `attributes`; only `service.name` and `service.instance.id` are reserved there.

### `destinations`

**Type:** `readonly ObservabilityDestination[]`

**Required:** Yes

At least one destination is required. Each destination declares the exporters it supports. Names must be nonblank and unique within the plugin because they identify the delivery target in diagnostics.

### `include`

**Type:** `string[]`

**Default:** `['log:*']`

Event-name patterns to export as logs. `*` is a wildcard. An empty array includes all events.

### `exclude`

**Type:** `string[]`  
**Default:** `[]`

Event-name patterns to suppress. Exclusions take precedence over inclusions.

`include` and `exclude` affect logs only. They do not enable, disable, or filter metrics.

### `batch`

| Field | Type | Default | Meaning |
|---|---|---:|---|
| `intervalMs` | `number` | `1000` | Maximum wait before flushing a log batch |
| `maxEntries` | `number` | `100` | Log entries that force a flush |

### `buffer`

| Field | Type | Default | Meaning |
|---|---|---:|---|
| `maxBatches` | `number` | `50` | Failed-log batch limit in legacy transport mode |
| `maxRetries` | `number` | `3` | Log retry limit in either mode |

In destination mode, `delivery.maxQueuedBatches` bounds each signal queue. Metric batches coalesce to the latest queued observation and are not retried.

### `metrics`

**Type:** `false | { intervalMs?: number }`

**Default:** `{ intervalMs: 30_000 }`

Set `false` to disable gauge collection. `intervalMs` must be a positive integer no greater than `2_147_483_647`.

### `delivery`

| Field | Type | Default | Meaning |
|---|---|---:|---|
| `deliveryTimeoutMs` | `number` | `5000` | Deadline for one destination export request |
| `shutdownTimeoutMs` | `number` | `3000` | Deadline used for queue flushes and destination shutdown work |
| `maxQueuedBatches` | `number` | `50` | Maximum queued batches held in memory |

All values must be positive integers. `maxQueuedBatches` cannot exceed 10,000.

## Legacy transport mode

```typescript
observability({
  transports: [createLokiTransport({ url: 'http://localhost:3100' })],
  include: ['log:*'],
});
```

Legacy mode is logs-only and preserves the existing batching, retry buffer, events, options, and plain-text Loki lines. The `resource`, `destinations`, `metrics`, and `delivery` options belong to destination mode. See [Migrate from transports](./migration.md) before switching an existing deployment.
