# Monitor Plugins

Monitor plugins are used to extend and enhance the process management and monitoring capabilities. These plugins can handle various aspects of process lifecycle, logging, and error management.

Monitor plugins can be used for a variety of tasks, including but not limited to:

- **Process Management**: Handling process lifecycle events like start, stop, and restart.
- **Error Handling**: Managing and responding to process errors and exceptions.
- **Log Management**: Processing and routing application logs and error messages.
- **Status Monitoring**: Tracking process health and performance metrics.
- **Event Handling**: Responding to PM2 bus events and system signals.

By leveraging monitor plugins and their hooks, developers can create flexible and powerful process management solutions that meet the specific needs of their applications.

## Type Reference

```typescript
type MonitorPlugin = {
  name: string;
  hooks: {
    beforeConnect?: (ctx: CombinedMonitorHookContext) => void | PromiseLike<void>;
    afterConnect?: (ctx: CombinedMonitorHookContext) => void | PromiseLike<void>;
    beforeDisconnect?: (ctx: CombinedMonitorHookContext) => void | PromiseLike<void>;
    afterDisconnect?: (ctx: CombinedMonitorHookContext) => void | PromiseLike<void>;
    beforeAppStart?: (ctx: CombinedMonitorHookContext, arg: { appName: string }) => void | PromiseLike<void>;
    afterAppStart?: (ctx: CombinedMonitorHookContext, arg: { appName: string; process: pm2.ProcessDescription }) => void | PromiseLike<void>;
    beforeAppStop?: (ctx: CombinedMonitorHookContext, arg: { appName: string }) => void | PromiseLike<void>;
    afterAppStop?: (ctx: CombinedMonitorHookContext, arg: { appName: string }) => void | PromiseLike<void>;
    onAppError?: (ctx: CombinedMonitorHookContext, arg: { appName: string; error: Error }) => void | PromiseLike<void>;
    onAppLog?: (ctx: CombinedMonitorHookContext, arg: { appName: string; data: string }) => void | PromiseLike<void>;
    onAppErrorLog?: (ctx: CombinedMonitorHookContext, arg: { appName: string; data: string }) => void | PromiseLike<void>;
    beforeShutdown?: (ctx: CombinedMonitorHookContext, arg: { code?: number }) => void | PromiseLike<void>;
  }
};
```

## Hooks

### `beforeConnect`/`afterConnect`

**When:** Called before/after connecting to PM2.

**Why:** These hooks allow plugins to perform setup/cleanup tasks when the monitor connects to PM2.

### `beforeDisconnect`/`afterDisconnect`

**When:** Called before/after disconnecting from PM2.

**Why:** These hooks enable plugins to handle cleanup or state management during PM2 disconnection.

### `beforeAppStart`/`afterAppStart`

**When:** Called before/after starting an application.

**Why:** These hooks allow plugins to perform setup tasks or respond to successful app launches.

### `beforeAppStop`/`afterAppStop`

**When:** Called before/after stopping an application.

**Why:** These hooks enable plugins to handle cleanup or state management during app shutdown.

### `onAppError`

**When:** Called when an application encounters an error.

**Why:** This hook allows plugins to handle and respond to application errors.

### `onAppLog`/`onAppErrorLog`

**When:** Called when an application outputs standard or error logs.

**Why:** These hooks enable plugins to process, route, or respond to application logs.

### `beforeShutdown`

**When:** Called before the monitor shuts down.

**Why:** This hook allows plugins to perform cleanup tasks before shutdown.

## Monitor Plugin Context

```typescript
type CombinedMonitorHookContext = {
  monitor: LaunchpadMonitor;
  logger: Logger;
  abortSignal: AbortSignal;
  cwd: string;
};
```

### `monitor`

Access to the monitor instance, providing access to process management and monitoring capabilities.

### `logger`

A plugin-specific logger for recording events and errors.

### `abortSignal`

Signals when the monitor process is shutting down, allowing plugins to handle cleanup.

### `cwd`

The current working directory of the monitor configuration. This is useful for resolving paths relative to the configuration files.