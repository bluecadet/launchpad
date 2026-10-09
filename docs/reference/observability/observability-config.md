---
title: "Observability Config"
---

`observability()` accepts destination mode or the legacy transport mode. Do not configure `destinations` and `transports` together.

## Destination mode

```typescript
observability({
  deployment: {
    client: 'museum',
    project: 'west-wing',
    installation: 'lobby-kiosk',
    environment: 'production',
    attributes: { region: 'us-east' },
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

### `deployment`

Required stable identity attached to every exported signal.

| Field | Type | Required |
|---|---|---|
| `client` | `string` | Yes |
| `project` | `string` | Yes |
| `installation` | `string` | Yes |
| `environment` | `string` | Yes |
| `attributes` | `Record<string, string \| number \| boolean>` | No |

Blank identity values fail validation. Custom attributes are limited to 64 entries. Keys are limited to 128 characters and string values to 1,024 characters. Numbers must be finite.

Launchpad maps deployment fields to resource attributes as follows:

| Configuration | Resource attribute |
|---|---|
| `client` | `launchpad.client` |
| `project` | `launchpad.project` |
| `installation` | `launchpad.installation` |
| `environment` | `deployment.environment.name` |

It also sets `service.name` to `launchpad` and generates a `service.instance.id` for each process setup. These keys are reserved and cannot be overridden through `attributes`.

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

Legacy mode is logs-only and preserves the existing batching, retry buffer, events, and plain-text Loki lines. See [Migrate from transports](./migration.md) before switching an existing deployment.
