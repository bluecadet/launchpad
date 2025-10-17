---
title: "Events Reference"
---

# Events Reference

The controller's EventBus provides a type-safe event system that enables communication between subsystems. This page provides an overview of all available events across the system.

## Type Safety

Events are fully type-safe through TypeScript declaration merging. Each subsystem declares its own events, which are automatically merged into the `LaunchpadEvents` interface:

```typescript
import { LaunchpadController } from '@bluecadet/launchpad-controller';
import '@bluecadet/launchpad-content'; // Import content event types
import '@bluecadet/launchpad-monitor'; // Import monitor event types

const controller = new LaunchpadController(config, logger);
const eventBus = controller.getEventBus();

// ✅ Type-safe - TypeScript knows the exact payload shape
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.totalFiles} files from ${data.sources.length} sources`);
  // data is typed as: { sources: string[], totalFiles: number, duration: number }
});
```

## Event Naming Conventions

Events follow a consistent naming pattern:

- **Namespace**: Subsystem prefix (`content:`, `monitor:`, `system:`)
- **Category**: The component or feature (`fetch`, `app`, `plugin`)
- **Action**: What happened (`start`, `done`, `error`)

Example: `content:fetch:start`, `monitor:app:started`

### Lifecycle Event Patterns

- `{namespace}:{category}:start` - Operation beginning
- `{namespace}:{category}:done` - Operation completed successfully
- `{namespace}:{category}:error` - Operation failed

### State Change Patterns

- Use past tense for completed state changes: `started`, `stopped`, `restarted`
- Include relevant identifiers in payload: `appName`, `sourceId`, etc.

## System Events

These events are emitted by the controller itself.

### `system:shutdown`
Emitted when the system is shutting down.

**Payload:**
```typescript
{
  code?: number;    // Exit code
  signal?: string;  // Signal that triggered shutdown (e.g., 'SIGINT')
}
```

### `system:error`
Emitted when a system-level error occurs.

**Payload:**
```typescript
{
  error: Error;      // The error object
  context?: string;  // Additional context about where the error occurred
}
```

### `command:start`
Emitted when a command begins execution.

**Payload:**
```typescript
{
  commandType: string;  // The type of command (e.g., 'content.fetch')
}
```

### `command:success`
Emitted when a command completes successfully.

**Payload:**
```typescript
{
  commandType: string;  // The type of command
  result?: unknown;     // Optional result from the command
}
```

### `command:error`
Emitted when a command fails.

**Payload:**
```typescript
{
  commandType: string;  // The type of command
  error: Error;         // The error that occurred
}
```

## Content Events

These events are emitted by `@bluecadet/launchpad-content` during content fetch operations.

### Fetch Lifecycle
- `content:fetch:start` - Content fetch process begins
- `content:fetch:done` - All content successfully fetched
- `content:fetch:error` - Fetch process encounters an error

### Source Events
- `content:source:start` - Individual source begins fetching
- `content:source:done` - Source completes successfully
- `content:source:error` - Source encounters an error

### Document Events
- `content:document:write` - Document successfully written to disk
- `content:document:error` - Document write fails

### Plugin Events
- `content:plugin:start` - Plugin begins processing
- `content:plugin:done` - Plugin completes successfully
- `content:plugin:error` - Plugin encounters an error

See [Content Events Reference](../content/events.md) for detailed payload documentation and usage examples.

## Monitor Events

These events are emitted by `@bluecadet/launchpad-monitor` during process management operations.

### Connection Lifecycle
- `monitor:connect:start` - PM2 connection begins
- `monitor:connect:done` - PM2 connection succeeds
- `monitor:connect:error` - PM2 connection fails
- `monitor:disconnect:start` - Disconnecting from PM2
- `monitor:disconnect:done` - Disconnection completes

### App Lifecycle
- `monitor:app:start` - App start requested
- `monitor:app:started` - App successfully started
- `monitor:app:stop` - App stop requested
- `monitor:app:stopped` - App successfully stopped
- `monitor:app:restart` - App restart requested
- `monitor:app:restarted` - App successfully restarted
- `monitor:app:error` - App operation encounters an error

### App State Changes
- `monitor:app:online` - App comes online
- `monitor:app:exit` - App exits
- `monitor:app:crash` - App crashes unexpectedly

### Window Management (Windows-specific)
- `monitor:window:foreground` - Window brought to foreground
- `monitor:window:minimize` - Window minimized
- `monitor:window:hide` - Window hidden
- `monitor:window:error` - Window management error

See [Monitor Events Reference](../monitor/events.md) for detailed payload documentation and usage examples.

## Listening to Events

### Specific Events

Listen to a specific event by name:

```typescript
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.totalFiles} files`);
});
```

### Event Patterns

Listen to multiple events matching a regex pattern:

```typescript
// Listen to all content events
eventBus.onPattern(/^content:.*$/, (event, data) => {
  console.log(`Content event: ${event}`, data);
});

// Listen to all error events
eventBus.onPattern(/.*:error$/, (event, data) => {
  console.error(`Error event: ${event}`, data.error);
});
```

### All Events

Listen to all events:

```typescript
eventBus.onAny((event, data) => {
  logger.debug(`Event: ${event}`, data);
});
```

### One-Time Listeners

Listen for an event only once:

```typescript
eventBus.once('content:fetch:done', (data) => {
  console.log('First fetch completed');
});
```

### Removing Listeners

```typescript
const handler = (data) => console.log(data);

eventBus.on('content:fetch:done', handler);

// Later...
eventBus.off('content:fetch:done', handler);
```

## Custom Events

Applications and plugins can define their own events using declaration merging:

```typescript
// my-plugin.ts
declare module '@bluecadet/launchpad-controller' {
  interface LaunchpadEvents {
    'plugin:myPlugin:ready': { version: string };
    'plugin:myPlugin:error': { error: Error };
  }
}

// Now these events are fully type-safe
eventBus.emit('plugin:myPlugin:ready', { version: '1.0.0' });

eventBus.on('plugin:myPlugin:ready', (data) => {
  console.log(`Plugin ready: v${data.version}`);
});
```
