---
title: "Observability Config"
---

# Observability Config

The `ObservabilityConfig` object is passed directly to the `observability()` plugin factory.

## `transports`

**Type:** `ObservabilityTransport[]`  
**Required:** Yes

Array of transport instances to forward log entries to. Create Loki transports with [`createLokiTransport()`](./transports/loki). Implement `ObservabilityTransport` directly for custom backends.

```typescript
import { createLokiTransport } from '@bluecadet/launchpad/observability/transports/loki';

observability({
  transports: [
    createLokiTransport({ url: 'http://loki:3100', defaultLabels: { app: 'kiosk' } }),
  ],
});
```

## `include`

**Type:** `string[]`  
**Default:** `["log:*"]`

Event name patterns to forward. Supports `*` wildcards. An empty array forwards all events.

```typescript
// Also forward lifecycle events alongside logs
observability({
  transports: [...],
  include: ['log:*', 'command:*', 'workflow:*', 'monitor:*', 'system:*'],
});
```

## `exclude`

**Type:** `string[]`  
**Default:** `[]`

Event name patterns to suppress. Takes precedence over `include`. Useful for silencing noisy events while keeping a broad include list.

```typescript
// Forward everything except verbose/debug logs
observability({
  transports: [...],
  exclude: ['log:verbose', 'log:debug'],
});
```

## `batch.intervalMs`

**Type:** `number`  
**Default:** `1000`

How often (in milliseconds) to flush the batch buffer to transports, regardless of batch size. Lower values reduce latency; higher values reduce HTTP overhead.

## `batch.maxEntries`

**Type:** `number`  
**Default:** `100`

Maximum number of log entries to accumulate before a forced flush. When this threshold is hit, the batch is sent immediately without waiting for `intervalMs`.

## `buffer.maxBatches`

**Type:** `number`  
**Default:** `50`

Maximum number of failed batches to hold in memory while retrying. When this limit is exceeded, the oldest batch is dropped and `observability:buffer:full` is emitted.

## `buffer.maxRetries`

**Type:** `number`  
**Default:** `3`

Maximum number of retry attempts per failed batch. Retries use exponential backoff starting at 1 second. After all retries are exhausted, the batch is dropped and `observability:push:dropped` is emitted.
