---
title: "Observability Events"
---

# Observability Events

The observability plugin emits events on the controller event bus to report the health of its transports. Subscribe to these events to build alerting, dashboards, or custom failure handling.

All events are fully type-safe through TypeScript declaration merging.

## Push Success

### `observability:push:success`
Emitted after a batch is successfully delivered to a transport.

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

## Push Failures

### `observability:push:error`
Emitted when a push attempt fails. The batch will be retried if retries remain.

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
Emitted when a batch is permanently discarded — either because it exhausted all retry attempts or because the in-memory buffer was full when a new failure arrived.

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
Emitted when the retry buffer hits its `maxBatches` cap and must evict an old batch to make room. This is a subset of `observability:push:dropped` (only fired when `reason === 'buffer-full'`), provided as a separate signal for buffer pressure monitoring.

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

## See Also

- [Observability Config](./observability-config) — configure retry limits and buffer size
- [Controller Events](/reference/controller/events) — core system events also forwarded by default
- [Monitor Events](/reference/monitor/events) — monitor events forwarded by default
