---
title: "Observability events"
---
These events report delivery in legacy `{ transports }` mode. Destination mode does not emit them; it exposes per-signal delivery state instead.

All events are typed through TypeScript declaration merging.

## Push success

### `observability:push:success`
Emitted after a transport delivers a batch.

**Payload:**
```typescript
{
  transport: string;   // Transport name (e.g. "loki")
  batchSize: number;   // Number of log entries in the batch
  durationMs: number;  // Round-trip time in milliseconds
}
```

**Example:**
```typescript
eventBus.on('observability:push:success', (data) => {
  console.log(`Pushed ${data.batchSize} entries to ${data.transport} in ${data.durationMs}ms`);
});
```

---

## Push failures

### `observability:push:error`
Emitted when a push attempt fails. The batch is retried if retries remain.

**Payload:**
```typescript
{
  transport: string;   // Transport name
  error: Error;        // The error that caused the failure
  batchSize: number;   // Number of entries in the failed batch
  retriesLeft: number; // Number of retry attempts remaining
}
```

**Example:**
```typescript
eventBus.on('observability:push:error', (data) => {
  console.error(
    `Push to ${data.transport} failed (${data.retriesLeft} retries left):`,
    data.error.message
  );
});
```

---

### `observability:push:dropped`
Emitted when a batch is permanently discarded, either because it exhausted its retries or because the in-memory buffer was full when a new failure arrived.

**Payload:**
```typescript
{
  transport: string;                       // Transport name
  batchSize: number;                       // Number of dropped entries
  reason: 'buffer-full' | 'max-retries';  // Why the batch was dropped
}
```

**Example:**
```typescript
eventBus.on('observability:push:dropped', (data) => {
  console.warn(
    `Dropped ${data.batchSize} log entries for ${data.transport}: ${data.reason}`
  );
});
```

---

### `observability:buffer:full`
Emitted when the retry buffer reaches its `maxBatches` cap and evicts an old batch. It fires only alongside `observability:push:dropped` with `reason === 'buffer-full'`, as a separate signal for monitoring buffer pressure.

**Payload:**
```typescript
{
  transport: string;    // Transport name
  droppedCount: number; // Number of entries in the evicted batch
}
```

**Example:**
```typescript
eventBus.on('observability:buffer:full', (data) => {
  console.warn(`Retry buffer full for ${data.transport} — evicted ${data.droppedCount} entries`);
});
```

---

## See also

- [Observability config](/reference/observability/observability-config/): retry limits and buffer size
- [Controller events](../controller/events.md): core system events; add patterns such as `command:*` to `include` to forward them
- [Monitor events](../monitor/events.md): add `monitor:*` to `include` to forward them
