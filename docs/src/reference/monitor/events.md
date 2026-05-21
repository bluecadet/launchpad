---
title: "Monitor Events"
---

# Monitor Events

When integrated with `@bluecadet/launchpad-controller`, the monitor package emits lifecycle events throughout process management. All events are fully type-safe through TypeScript declaration merging.

## Connection Lifecycle Events

### `monitor:connect:start`
Emitted when PM2 connection begins.

**Payload:**
```typescript
{}  // Empty object
```

**Example:**
```typescript
eventBus.on('monitor:connect:start', () => {
  console.log('Connecting to PM2...');
});
```

---

### `monitor:connect:done`
Emitted when PM2 connection succeeds.

**Example:**
```typescript
eventBus.on('monitor:connect:done', () => {
  console.log(`Connected to PM2.`);
});
```

---

### `monitor:connect:error`
Emitted when PM2 connection fails.

**Payload:**
```typescript
{
  error: Error;  // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('monitor:connect:error', (data) => {
  console.error('Failed to connect to PM2:', data.error);
});
```

---

### `monitor:disconnect:start`
Emitted when disconnecting from PM2.

**Payload:**
```typescript
{}  // Empty object
```

---

### `monitor:disconnect:done`
Emitted when disconnection completes.

**Payload:**
```typescript
{}  // Empty object
```

## App Lifecycle Events

### `monitor:app:start`
Emitted when an app start is requested (before the app actually starts).

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id?: number;   // PM2 ID (if known)
}
```

**Example:**
```typescript
eventBus.on('monitor:app:start', (data) => {
  console.log(`Starting ${data.appName}...`);
});
```

---

### `monitor:app:started`
Emitted when an app has successfully started and is running.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
  pid: number;      // System process ID
}
```

**Example:**
```typescript
eventBus.on('monitor:app:started', (data) => {
  console.log(`${data.appName} started with PID ${data.pid}`);
});
```

---

### `monitor:app:stop`
Emitted when an app stop is requested (before the app actually stops).

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id?: number;   // PM2 ID (if known)
}
```

**Example:**
```typescript
eventBus.on('monitor:app:stop', (data) => {
  console.log(`Stopping ${data.appName}...`);
});
```

---

### `monitor:app:stopped`
Emitted when an app has successfully stopped.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
}
```

**Example:**
```typescript
eventBus.on('monitor:app:stopped', (data) => {
  console.log(`${data.appName} stopped`);
});
```

---

### `monitor:app:restart`
Emitted when an app restart is requested (before the restart begins).

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id?: number;   // PM2 ID (if known)
}
```

**Example:**
```typescript
eventBus.on('monitor:app:restart', (data) => {
  console.log(`Restarting ${data.appName}...`);
});
```

---

### `monitor:app:restarted`
Emitted when an app has successfully restarted.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
  pid: number;      // New system process ID
}
```

**Example:**
```typescript
eventBus.on('monitor:app:restarted', (data) => {
  console.log(`${data.appName} restarted with new PID ${data.pid}`);
});
```

---

### `monitor:app:error`
Emitted when an app operation encounters an error.

**Payload:**
```typescript
{
  appName: string;                              // Name of the app
  error: Error;                                 // The error that occurred
  operation?: 'start' | 'stop' | 'restart';    // The operation that failed
}
```

**Example:**
```typescript
eventBus.on('monitor:app:error', (data) => {
  console.error(`${data.appName} ${data.operation || 'operation'} failed:`, data.error);
});
```

## App State Change Events

### `monitor:app:online`
Emitted when an app comes online.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
  pid: number;      // System process ID
}
```

**Example:**
```typescript
eventBus.on('monitor:app:online', (data) => {
  console.log(`${data.appName} is now online (PID ${data.pid})`);
});
```

---

### `monitor:app:exit`
Emitted when an app exits.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
  exitCode: number; // Exit code
  signal?: string;  // Signal that caused exit (e.g., 'SIGTERM')
}
```

**Example:**
```typescript
eventBus.on('monitor:app:exit', (data) => {
  console.log(`${data.appName} exited with code ${data.exitCode}`);
  if (data.signal) {
    console.log(`  Signal: ${data.signal}`);
  }
});
```

---

### `monitor:app:crash`
Emitted when an app crashes unexpectedly.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  pm2Id: number;    // PM2 process ID
  error: Error;     // The error that caused the crash
}
```

**Example:**
```typescript
eventBus.on('monitor:app:crash', (data) => {
  console.error(`${data.appName} crashed:`, data.error);
  // Trigger alerts, logging, etc.
});
```

---

### `monitor:app:log`
Emitted when an app outputs to stdout.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  data: string;     // Log output
}
```

---

### `monitor:app:errorLog`
Emitted when an app outputs to stderr.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  data: string;     // Error log output
}
```

## Shutdown Events

### `monitor:beforeShutdown`
Emitted just before the monitor begins shutting down.

**Payload:**
```typescript
{
  code?: number;  // Optional exit code
}
```

> [!NOTE]
> This event is fire-and-forget — the monitor does not wait for listeners to complete before proceeding with shutdown. Plugins that need to react to monitor shutdown should use their own `disconnect()` lifecycle on the controller.

## Window Management Events

These events are Windows-specific and only emitted when window management features are used.

### `monitor:window:foreground`
Emitted when a window is brought to the foreground.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  hwnd: number;     // Window handle
}
```

**Example:**
```typescript
eventBus.on('monitor:window:foreground', (data) => {
  console.log(`${data.appName} window brought to foreground`);
});
```

---

### `monitor:window:minimize`
Emitted when a window is minimized.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  hwnd: number;     // Window handle
}
```

---

### `monitor:window:hide`
Emitted when a window is hidden.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  hwnd: number;     // Window handle
}
```

---

### `monitor:window:error`
Emitted when window management encounters an error.

**Payload:**
```typescript
{
  appName: string;  // Name of the app
  error: Error;     // The error that occurred
}
```

**Example:**
```typescript
eventBus.on('monitor:window:error', (data) => {
  console.error(`Window management error for ${data.appName}:`, data.error);
});
```

## See Also

- [Controller Events Reference](../controller/events.md) - Complete event system documentation
- [Content Events](../content/events.md) - Content subsystem events
- [Monitor Configuration](./monitor-config.md) - Monitor configuration options
