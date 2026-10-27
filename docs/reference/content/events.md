---
title: "Content events"
---
With `@bluecadet/launchpad-controller`, the content package emits lifecycle events during each fetch. TypeScript declaration merging types every event.

## Fetch lifecycle events

### `content:fetch:start`
Emitted when a content fetch starts.

**Payload:**
```typescript
{
  timestamp: Date;  // When the fetch started
}
```

**Example:**
```typescript
eventBus.on('content:fetch:start', (data) => {
  console.log(`Content fetch started at ${data.timestamp.toISOString()}`);
});
```

---

### `content:fetch:done`
Emitted when every source has been fetched.

**Payload:**
```typescript
{
  sources: string[];   // IDs of sources that were fetched
}
```

**Example:**
```typescript
eventBus.on('content:fetch:done', (data) => {
  console.log(`Sources: ${data.sources.join(', ')}`);
});
```

---

### `content:fetch:error`
Emitted when a fetch fails.

**Payload:**
```typescript
{
  error: Error;      // The error that occurred
  source?: string;   // Optional: ID of the source that failed
}
```

**Example:**
```typescript
eventBus.on('content:fetch:error', (data) => {
  console.error('Content fetch failed:', data.error);
  if (data.source) {
    console.error(`Failed source: ${data.source}`);
  }
});
```

## Source events

### `content:source:start`
Emitted when a source starts fetching.

**Payload:**
```typescript
{
  sourceId: string;    // ID of the source
  sourceType: string;  // Type of source (e.g., 'sanity', 'contentful')
}
```

**Example:**
```typescript
eventBus.on('content:source:start', (data) => {
  console.log(`Fetching from ${data.sourceType} source: ${data.sourceId}`);
});
```

---

### `content:source:done`
Emitted when a source fetch succeeds.

**Payload:**
```typescript
{
  sourceId: string;      // ID of the source
}
```

**Example:**
```typescript
eventBus.on('content:source:done', (data) => {
  console.log(`Source ${data.sourceId} fetched`);
});
```

---

### `content:source:error`
Emitted when a source fails.

**Payload:**
```typescript
{
  sourceId: string;  // ID of the source
  error: Error;      // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('content:source:error', (data) => {
  console.error(`Source ${data.sourceId} failed:`, data.error);
});
```

## Document events

### `content:document:write`
Emitted when a document is written to the current run's staged output.

**Payload:**
```typescript
{
  sourceId: string;    // ID of the source
  documentId: string;  // ID of the document
  path: string;        // Absolute staged file path for this run
}
```

`path` points to the staged file under `tempPath/runs/<runId>/downloads/...`, not the published file under `downloadPath`. Launchpad promotes the staged tree into `downloadPath` after a successful run.

**Example:**
```typescript
eventBus.on('content:document:write', (data) => {
  console.log(`Wrote staged document ${data.documentId} to ${data.path}`);
});
```

---

### `content:document:error`
Emitted when a document write fails.

**Payload:**
```typescript
{
  sourceId: string;    // ID of the source
  documentId: string;  // ID of the document
  error: Error;        // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('content:document:error', (data) => {
  console.error(`Failed to write document ${data.documentId}:`, data.error);
});
```

## Transform events

### `content:transform:start`
Emitted when a transform starts.

**Payload:**
```typescript
{
  transformName: string;  // Name of the transform
}
```

**Example:**
```typescript
eventBus.on('content:transform:start', (data) => {
  console.log(`Running transform: ${data.transformName}`);
});
```

---

### `content:transform:done`
Emitted when a transform succeeds.

**Payload:**
```typescript
{
  transformName: string;  // Name of the transform
  duration: number;       // Time taken in milliseconds
}
```

**Example:**
```typescript
eventBus.on('content:transform:done', (data) => {
  console.log(`Transform ${data.transformName} completed in ${data.duration}ms`);
});
```

---

### `content:transform:error`
Emitted when a transform fails.

**Payload:**
```typescript
{
  transformName: string;  // Name of the transform
  error: Error;           // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('content:transform:error', (data) => {
  console.error(`Transform ${data.transformName} failed:`, data.error);
});
```

## See also

- [Controller events](../controller/events.md): the full event system
- [Monitor events](../monitor/events.md)
