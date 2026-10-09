---
title: "Observability Config"
---

`observability()` accepts destination mode or the legacy transport mode. Do not configure `destinations` and `transports` together.

## Destination mode

Configured destinations read the controller's canonical file by default. File directory and retention policy belong to the controller:

```typescript
export default defineConfig({
  controller: {
    logging: {
      dirname: '.logs',
      text: { enabled: true, level: 'info' },
    },
  },
  plugins: [
    observability({
      destinations: [destination],
    }),
  ],
});
```

Omitting `logStorage` is equivalent to `{ type: 'file' }`. Use `{ type: 'memory' }` to opt out of retained log delivery. The remaining destination options are independent of the controller's file policy:

```typescript
observability({
  resource: { 'service.name': 'museum-kiosk' },
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

At least one destination is required. Each destination declares the exporters it supports. Names must be nonblank and unique after trimming within the plugin because they identify the delivery target in diagnostics and file-delivery checkpoints. The name `__proto__` is rejected.

### `logStorage`

**Type:** `{ type: 'file' } | { type: 'memory' }`

**Default:** `{ type: 'file' }`

**Required:** No

Selects the log delivery source. Omitted or `{ type: 'file' }` uses checkpointed delivery from the controller-owned canonical JSONL. Explicit `{ type: 'memory' }` uses bounded in-memory batching without replay, suitable for tests, ephemeral delivery, or custom log exporters that do not support replay. This opt-out does not disable controller logging.

File delivery is available only in destination mode and only for destinations with a log exporter. Legacy `transports` retain their existing in-memory path and reject both `{ type: 'file' }` and `{ type: 'memory' }`. The logging owner controls the directory, format, rotation, and retention; `logStorage` does not accept directory, size, or age settings.

Each destination reads independently. A newly enrolled destination starts at the oldest canonical record still retained. After an acknowledged export, an atomic checkpoint records its progress. Restarting with the same destination `name`, credential-free `checkpointKey`, and controller log source resumes from that checkpoint. Built-in Loki and OTLP destinations derive the key from their normalized endpoint. Changing the name or endpoint enrolls a new reader at the oldest retained record. Rotating a token or headers keeps the existing checkpoint.

**Backfill warning:** enabling a destination can immediately export historical records, increasing ingestion costs. Backends may reject records older than their accepted timestamp window. Check retained data and backend policy before enrollment. Bounded controller retention can expire unread records, and a lost acknowledgement can cause duplicate replay; delivery is neither lossless nor exactly once.

Memory delivery does not advance file checkpoints. Switching from memory to file resumes from an existing checkpoint, or the oldest retained record if none exists, and may replay records already sent from memory.

For endpoints shared by multiple accounts, such as a common Grafana gateway, credentials are deliberately excluded from checkpoint identity. Change the destination name when switching accounts so the new account does not inherit the old account's delivery position.

File delivery preserves each record's original timestamp and resource snapshot. Custom log exporters must provide a stable `checkpointKey` and `supportsResourceContext: true`, and honor the replayed resource context; otherwise configure explicit memory delivery. See [custom destination support](./custom-destinations.md#file-delivery-support). An unavailable canonical file source never causes an automatic fallback to memory. Metrics always remain latest, coalesced in-memory snapshots and are not reconstructed from the log.

### `include`

**Type:** `string[]`

**Default:** `['log:*']`

Event-name patterns to export as logs. `*` is a wildcard. An empty array includes all available events.

In default file delivery, these filters select only [canonical records captured by the controller](../controller/logging.md#recorded-events), not every raw custom bus event. Use explicit memory delivery if you need the legacy live-bus capture behavior for custom events; changing `include` cannot add unrecorded events to the canonical source.

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
| `maxRetries` | `number` | `3` | Log retry limit in memory delivery and the retry attempt limit for a file-backed batch |

In destination mode, `delivery.maxQueuedBatches` bounds each in-memory signal queue. Metric batches coalesce to the latest queued observation and are not retried. File-backed logs remain available from the canonical log until their checkpoint advances or controller retention removes them. Queue limits do not create a second sidecar or spool.

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

Legacy mode is logs-only and preserves the existing in-memory batching, retry buffer, events, options, and plain-text Loki lines. The `resource`, `destinations`, `metrics`, `delivery`, and `logStorage` options belong to destination mode and are rejected in legacy mode. This includes `logStorage` with either `'file'` or `'memory'`. See [Migrate from transports](./migration.md) before switching an existing deployment.
