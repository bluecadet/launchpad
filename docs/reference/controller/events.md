---
title: "Controller events"
---
Subsystems communicate through the controller's type-safe EventBus. This page gives an overview of events across the system.

## Type safety

Events are typed through TypeScript declaration merging. Each subsystem declares its events on `@bluecadet/launchpad-utils/types`, and they merge into the `LaunchpadEvents` interface:

```typescript
import { LaunchpadController } from '@bluecadet/launchpad/controller';

const controller = new LaunchpadController(controllerConfig, process.cwd());
const eventBus = controller.getEventBus();

// ✅ Type-safe - TypeScript knows the exact payload shape
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.sources.length} sources`);
  // data is typed as: { sources: string[] }
});
```

## Event naming conventions

Event names have three parts:

- Namespace: the subsystem prefix (`content:`, `monitor:`, `system:`)
- Category: the component or feature (`fetch`, `app`, `plugin`)
- Action: what happened (`start`, `done`, `error`)

Examples: `content:fetch:start`, `monitor:app:started`

### Lifecycle event patterns

- `{namespace}:{category}:start`: operation began
- `{namespace}:{category}:done`: operation succeeded
- `{namespace}:{category}:error`: operation failed

### State change patterns

- Use past tense for completed state changes: `started`, `stopped`, `restarted`
- Include identifiers in the payload, such as `appName` or `sourceId`

## System events

The controller emits these events.

### `system:shutdown`
Signals that the process should exit. The IPC transport emits it when it receives a shutdown command, and the CLI entry point responds by calling `process.exit()`.

**Payload:**
```typescript
{
  code?: number;    // Exit code
  signal?: string;  // Signal that triggered shutdown (e.g., 'SIGINT')
}
```

### `system:error`
Emitted on a system-level error.

**Payload:**
```typescript
{
  error: Error;      // The error object
  context?: string;  // Additional context about where the error occurred
}
```

### `command:start`
Emitted when a command starts.

**Payload:**
```typescript
{
  commandType: string;  // The type of command (e.g., 'content.fetch')
}
```

### `command:success`
Emitted when a command succeeds.

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

## Workflow events

Named workflows emit these events.

- `workflow:start`: workflow begins
- `workflow:step:start`: a step begins
- `workflow:step:success`: a step succeeds
- `workflow:step:error`: a step fails
- `workflow:success`: workflow succeeds
- `workflow:error`: workflow fails

Common payload fields:

```typescript
{
  name: string;       // Workflow name
  stepCount?: number; // Total number of steps
  stepIndex?: number; // Zero-based step index
  command?: BaseCommand;
  error?: Error;
}
```

## Content events

`@bluecadet/launchpad-content` emits these events while fetching content.

### Fetch lifecycle
- `content:fetch:start`: fetch begins
- `content:fetch:done`: all content fetched
- `content:fetch:error`: fetch failed
- `content:version:promoted`: new version published, emitted right after the manifest swap (versioned output only)

### Source events
- `content:source:start`: a source begins fetching
- `content:source:done`: a source succeeds
- `content:source:error`: a source fails

### Document events
- `content:document:write`: document written to the staged run output, promoted later if the fetch succeeds
- `content:document:error`: document write failed

### Transform events
- `content:transform:start`: transform begins
- `content:transform:done`: transform succeeds
- `content:transform:error`: transform fails

See the [content events reference](../content/events.md) for payloads and examples.

## Monitor events

`@bluecadet/launchpad-monitor` emits these events while managing processes.

### Connection lifecycle
- `monitor:connect:start`: PM2 connection begins
- `monitor:connect:done`: PM2 connection succeeds
- `monitor:connect:error`: PM2 connection fails
- `monitor:disconnect:start`: disconnecting from PM2
- `monitor:disconnect:done`: disconnected

### App lifecycle
- `monitor:app:start`: app start requested
- `monitor:app:started`: app started
- `monitor:app:stop`: app stop requested
- `monitor:app:stopped`: app stopped
- `monitor:app:restart`: app restart requested
- `monitor:app:restarted`: app restarted
- `monitor:app:error`: app operation failed

### App state changes
- `monitor:app:online`: app came online
- `monitor:app:exit`: app exited
- `monitor:app:crash`: app crashed

### App output
- `monitor:app:log`: app wrote to stdout. Payload: `{ appName: string; data: string }`
- `monitor:app:errorLog`: app wrote to stderr. Payload: `{ appName: string; data: string }`

### Shutdown
- `monitor:beforeShutdown`: monitor is about to stop its apps and disconnect from PM2. Payload: `{ code?: number }`

### Window management (Windows only)
- `monitor:window:foreground`: window brought to the foreground
- `monitor:window:minimize`: window minimized
- `monitor:window:hide`: window hidden
- `monitor:window:error`: window management failed

See the [monitor events reference](../monitor/events.md) for payloads and examples.

## Observability events

`@bluecadet/launchpad-observability` emits these events while pushing telemetry.

- `observability:push:success`: batch pushed to a transport
- `observability:push:error`: push attempt failed; retried if retries remain
- `observability:push:dropped`: batch dropped after max retries or a full buffer
- `observability:buffer:full`: retry buffer full; oldest batch evicted

See the [observability events reference](../observability/events.md) for payloads.

## Log events

`@bluecadet/launchpad-utils` declares the logger events: `log:error`, `log:warn`, `log:info`, `log:debug`, `log:verbose`, plus `log:tty` and `log:tty:close` for fixed TTY console messages.

## Listening to events

### Specific events

Listen to one event by name:

```typescript
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.sources.length} sources`);
});
```

### Event patterns

Listen to every event that matches a regex:

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

### All events

Listen to every event:

```typescript
eventBus.onAny((event, data) => {
  logger.debug(`Event: ${event}`, data);
});
```

### One-time listeners

Listen for an event once:

```typescript
eventBus.once('content:fetch:done', (data) => {
  console.log('First fetch completed');
});
```

### Removing listeners

```typescript
const handler = (data) => console.log(data);

eventBus.on('content:fetch:done', handler);

// Later...
eventBus.off('content:fetch:done', handler);
```

## Custom events

Applications and plugins can define their own events with declaration merging:

```typescript
// my-plugin.ts
declare module '@bluecadet/launchpad-utils/types' {
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
