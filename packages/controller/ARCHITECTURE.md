# Controller Architecture: Commands vs Events

## Overview

The controller uses two distinct patterns for subsystem communication:
1. **Commands** - Request/response pattern via `executeCommand()`
2. **Events** - Notification pattern via EventBus

This document explains why we use both and when to use each.

## Commands: Request/Response Pattern

### What Are Commands?

Commands are imperative actions that expect a result:

```typescript
const result = await controller.executeCommand({
  type: 'content.fetch',
  sources: ['sanity']
});

if (result.isOk()) {
  console.log('Success:', result.value);
} else {
  console.error('Failed:', result.error);
}
```

### Why Use Commands?

#### 1. Explicit Result Handling

Commands return `ResultAsync<T, E>` which forces proper error handling:

```typescript
// ✅ You MUST handle both success and error cases
const result = await controller.executeCommand(command);
result.match(
  (value) => console.log('Success:', value),
  (error) => console.error('Failed:', error)
);

// Compare to events:
eventBus.emit('content.fetch', {}); // Fire and forget - no result!
```

#### 2. Synchronous Feedback

CLI commands need immediate feedback:

```bash
$ launchpad content fetch
✓ Downloaded 42 files from 3 sources
```

Without a result, you'd need complex event coordination:

```typescript
// ❌ Complex event coordination
let result: unknown;
eventBus.once('content:fetch:done', (data) => result = data);
eventBus.once('content:fetch:error', (data) => throw data.error);
eventBus.emit('content:fetch', {});
await waitForResult(); // How long do we wait?
```

#### 3. Clear Semantics

Commands are imperative ("do this"):
- `content.fetch` - Fetch content now
- `monitor.app.start` - Start this app
- `system.shutdown` - Shut down

Events are declarative ("this happened"):
- `content:fetch:done` - Content was fetched
- `monitor:app:started` - App started
- `system:shutdown` - System is shutting down

#### 4. Type-Safe Routing

Each subsystem handles its own command routing:

```typescript
// In LaunchpadContent
async executeCommand(command: ContentCommand): ResultAsync<unknown, Error> {
  switch (command.type) {
    case 'content.fetch':
      return this.fetch(command);
    case 'content.clear':
      return this.clear(command);
    default:
      return errAsync(new Error(`Unknown command: ${command.type}`));
  }
}
```

The controller just delegates - no giant switch statement!

### Command Flow

```
CLI User Input
    ↓
CLI Command Handler
    ↓
LaunchpadController.executeCommand()
    ↓
CommandDispatcher.dispatch()
    ↓
Subsystem.executeCommand()
    ↓
ResultAsync<T, E>
    ↓
CLI Output to User
```

## Events: Notification Pattern

### What Are Events?

Events are notifications that something happened:

```typescript
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.totalFiles} files`);
});

// Later...
eventBus.emit('content:fetch:done', {
  sources: ['sanity'],
  totalFiles: 42,
  duration: 1234
});
```

### Why Use Events?

#### 1. Decoupled Communication

Subsystems can react to each other without direct dependencies:

```typescript
// Monitor can react to content changes
eventBus.on('content:fetch:done', async () => {
  // Restart apps to pick up new content
  await this.restartAllApps();
});

// Content doesn't know or care that monitor is listening
```

#### 2. Observability

Events provide visibility into system behavior:

```typescript
// Logging plugin
eventBus.onAny((event, data) => {
  logger.info(`Event: ${event}`, data);
});

// Metrics plugin
eventBus.onPattern(/^content:/, (event) => {
  metrics.increment(`event.${event}`);
});
```

#### 3. Extensibility

Users can add custom behavior without modifying core code:

```typescript
// User's launchpad.config.js
export default defineConfig({
  monitor: {
    plugins: [
      {
        name: 'notify-on-error',
        hooks: {
          async afterConnect({ eventBus }) {
            eventBus.on('monitor:app:crash', async (data) => {
              await sendSlackNotification(`App crashed: ${data.appName}`);
            });
          }
        }
      }
    ]
  }
});
```

#### 4. Async Reactions

Multiple subscribers can react independently:

```typescript
// All run concurrently, none block the emitter
eventBus.on('content:fetch:done', async () => { /* ... */ });
eventBus.on('content:fetch:done', async () => { /* ... */ });
eventBus.on('content:fetch:done', async () => { /* ... */ });

eventBus.emit('content:fetch:done', data); // Returns immediately
```

### Event Flow

```
Subsystem Operation
    ↓
emit('subsystem:operation:start')
    ↓
[All Subscribers Notified]
    ↓
Operation Logic
    ↓
emit('subsystem:operation:done')
    ↓
[All Subscribers Notified]
```

## When to Use Each

### Use Commands When:

✅ You need a result/response
✅ The operation is user-initiated (CLI, API)
✅ You need to know if it succeeded or failed
✅ You need to return data to the caller
✅ You need synchronous feedback

**Examples:**
- `content.fetch` - User wants to know if fetch succeeded
- `monitor.app.start` - User wants to know if app started
- `system.shutdown` - User wants to know if shutdown initiated

### Use Events When:

✅ Broadcasting notifications
✅ Multiple systems need to react
✅ You don't need a response
✅ You want loose coupling
✅ You want extensibility

**Examples:**
- `content:fetch:done` - Notify that fetch completed
- `monitor:app:crash` - Notify that app crashed
- `system:error` - Notify of system error

## Lifecycle Example: Content Fetch

Here's how commands and events work together:

```typescript
// 1. User initiates via command
const result = await controller.executeCommand({
  type: 'content.fetch'
});

// 2. Inside LaunchpadContent.fetch()
async fetch(): ResultAsync<void, Error> {
  // Emit event: Operation starting
  this._eventBus?.emit('content:fetch:start', {
    sources: this._sources.map(s => s.id),
    timestamp: new Date()
  });

  try {
    // Do the work...
    const files = await this._fetchAllSources();

    // Emit event: Operation succeeded
    this._eventBus?.emit('content:fetch:done', {
      sources: this._sources.map(s => s.id),
      totalFiles: files.length,
      duration: Date.now() - startTime
    });

    // Return result to command caller
    return okAsync(undefined);
  } catch (error) {
    // Emit event: Operation failed
    this._eventBus?.emit('content:fetch:error', {
      error: error as Error
    });

    // Return error to command caller
    return errAsync(error as Error);
  }
}

// 3. Meanwhile, other subsystems react to events
eventBus.on('content:fetch:done', async (data) => {
  // Monitor restarts apps
  await monitor.restartAllApps();
});

eventBus.on('content:fetch:done', async (data) => {
  // Logger records metrics
  logger.info(`Fetched ${data.totalFiles} files in ${data.duration}ms`);
});

// 4. CLI displays result to user
if (result.isOk()) {
  console.log('✓ Content fetched successfully');
} else {
  console.error('✗ Failed to fetch content:', result.error.message);
}
```

## Benefits of This Architecture

### Clear Separation of Concerns
- Commands = control flow (imperative)
- Events = data flow (declarative)

### Type Safety
- Commands use `ResultAsync<T, E>` for explicit error handling
- Events use declaration merging for type-safe payloads

### Testability
- Commands easy to test with assertions on results
- Events easy to test by subscribing and collecting

### Loose Coupling
- Controller doesn't know subsystem internals
- Subsystems don't know about each other
- Plugins can extend behavior without modifying core

### Extensibility
- Users can subscribe to events
- Users can add custom command handlers (Phase 2)
- Users can create custom events

## Anti-Patterns to Avoid

### ❌ Don't Use Events for Request/Response

```typescript
// ❌ BAD: Using events for commands
eventBus.emit('content:fetch', { sources: ['sanity'] });
// How do you know if it worked? You don't!

// ✅ GOOD: Use commands for requests
const result = await controller.executeCommand({
  type: 'content.fetch',
  sources: ['sanity']
});
```

### ❌ Don't Block Event Handlers

```typescript
// ❌ BAD: Event handler blocks emitter
eventBus.on('content:fetch:done', async (data) => {
  await slowDatabaseOperation(); // Blocks other handlers!
});

// ✅ GOOD: Fire and forget
eventBus.on('content:fetch:done', (data) => {
  // Kick off async work without awaiting
  slowDatabaseOperation().catch(console.error);
});
```

### ❌ Don't Use Commands for Notifications

```typescript
// ❌ BAD: Using commands for notifications
await controller.executeCommand({
  type: 'content.notify.fetchDone' // This should be an event!
});

// ✅ GOOD: Use events for notifications
eventBus.emit('content:fetch:done', { totalFiles: 42 });
```

## Summary

| Aspect | Commands | Events |
|--------|----------|--------|
| Purpose | Request action | Notify of occurrence |
| Response | ResultAsync<T, E> | None (fire-and-forget) |
| Coupling | Tight (caller → subsystem) | Loose (publisher ↔ subscribers) |
| Use Case | User-initiated actions | System reactions |
| Example | `content.fetch` | `content:fetch:done` |
| Type Safety | Strong (via command types) | Strong (via declaration merging) |
| Error Handling | Explicit (Result type) | None (subscribers handle own errors) |

Both patterns are essential:
- **Commands** give users control and feedback
- **Events** give subsystems awareness and extensibility
