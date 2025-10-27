---
title: "Content Events"
---

# Content Events

When integrated with `@bluecadet/launchpad-controller`, the content package emits lifecycle events throughout the fetch process. All events are fully type-safe through TypeScript declaration merging.

## Fetch Lifecycle Events

### `content:fetch:start`
Emitted when the content fetch process begins.

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
Emitted when all content has been successfully fetched.

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
Emitted when the fetch process encounters an error.

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

## Source Events

### `content:source:start`
Emitted when a content source begins fetching.

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
Emitted when a source completes successfully.

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
Emitted when a source encounters an error.

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

## Document Events

### `content:document:write`
Emitted when a document is successfully written to disk.

**Payload:**
```typescript
{
  sourceId: string;    // ID of the source
  documentId: string;  // ID of the document
  path: string;        // File path where document was written
}
```

**Example:**
```typescript
eventBus.on('content:document:write', (data) => {
  console.log(`Wrote ${data.documentId} to ${data.path}`);
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

## Plugin Events

### `content:plugin:start`
Emitted when a content plugin begins processing.

**Payload:**
```typescript
{
  pluginName: string;  // Name of the plugin
}
```

**Example:**
```typescript
eventBus.on('content:plugin:start', (data) => {
  console.log(`Running plugin: ${data.pluginName}`);
});
```

---

### `content:plugin:done`
Emitted when a plugin completes successfully.

**Payload:**
```typescript
{
  pluginName: string;  // Name of the plugin
  duration: number;    // Time taken in milliseconds
}
```

**Example:**
```typescript
eventBus.on('content:plugin:done', (data) => {
  console.log(`Plugin ${data.pluginName} completed in ${data.duration}ms`);
});
```

---

### `content:plugin:error`
Emitted when a plugin encounters an error.

**Payload:**
```typescript
{
  pluginName: string;  // Name of the plugin
  error: Error;        // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('content:plugin:error', (data) => {
  console.error(`Plugin ${data.pluginName} failed:`, data.error);
});
```

## See Also

- [Controller Events Reference](../controller/events.md) - Complete event system documentation
- [Monitor Events](../monitor/events.md) - Monitor subsystem events
