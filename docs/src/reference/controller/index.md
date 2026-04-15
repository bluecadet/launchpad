## Integration with Subsystems

Plugins integrate with the controller through two complementary contracts:

**Plugin properties** — capabilities the plugin *offers* to the controller:

```typescript
type InstantiatedPlugin<TCommand> = Partial<
  CommandExecutor<TCommand> &  // Execute commands
  Disconnectable               // Clean disconnect
>;
```

**Plugin manifest** — explicit controller-owned metadata for command registration and lifecycle behavior:

```typescript
interface PluginManifest<TCommand extends BaseCommand = BaseCommand> {
  commands?: readonly CommandDescriptor<TCommand>[];
  lifecycle?: {
    startupCommands?: readonly TCommand[];
  };
}
```

**PluginContext** — infrastructure the controller *provides* to the plugin:

```typescript
interface PluginContext<TState = unknown> {
  eventBus: EventBus;          // Type-safe event bus
  logger: Logger;              // Scoped logger
  abortSignal: AbortSignal;    // Cancelled on controller shutdown
  cwd: string;                 // Working directory
  dispatchCommand: (command) => ResultAsync<unknown, Error>;
  updateState: (producer: (draft: TState) => void) => void;
  getGlobalState: () => VersionedLaunchpadState;
  onGlobalStatePatch: (handler) => () => void;
  dashboardRegistry: DashboardRegistry;
  statusRegistry: StatusRegistry;
}
```

### Explicit Command Registration

Plugins that handle commands must declare them in `manifest.commands` and implement `executeCommand()`:

```typescript
interface CommandExecutor<TCommand> {
  executeCommand(command: TCommand): ResultAsync<unknown, Error>;
}

definePlugin({
  name: 'my-plugin',
  manifest: {
    commands: [{ id: 'my-plugin.increment' }],
    lifecycle: {
      startupCommands: [{ type: 'my-plugin.increment' }],
    },
  },
  setup(ctx: PluginContext<MyState>) {
    ctx.updateState(() => ({ count: 0 }));

    return okAsync({
      executeCommand(command) {
        ctx.updateState(draft => { draft.count++; });
        return okAsync(undefined);
      }
    });
  }
});
```

The controller only dispatches commands that have been explicitly registered. Launchpad no longer infers command ownership from command name prefixes.

### State Management

Plugins own their domain logic; the controller owns the state infrastructure. Plugins call `ctx.updateState()` to establish and mutate their state slice — the controller lazily creates a scoped store on first call and handles patch generation, versioning, and broadcasting.

To read the full aggregated state (all plugins + system), use `ctx.getGlobalState()`. Prefer `ctx.eventBus` or `ctx.dispatchCommand` for cross-plugin communication over polling global state.

### Dashboard Contributions

Plugins register UI contributions (panels, pages, scripts, styles, routes) via `ctx.dashboardRegistry` and CLI status sections via `ctx.statusRegistry` during `setup()`. These registries are controller-owned instances — each controller maintains its own isolated registry, enabling clean testing and multi-instance scenarios.

### Disconnectable

Plugins that manage long-lived resources (connections, child processes) implement `disconnect()`. It is called *after* `abortSignal` is fired, so in-flight async work is already cancelled by the time `disconnect()` runs.

```typescript
interface Disconnectable {
  disconnect(reason: DisconnectReason): ResultAsync<void, Error>;
}
```

## Usage Modes

### Task Mode

Ephemeral controller instances for one-off operations:

1. Create controller in task mode
2. Register subsystems
3. Start controller
4. Execute command(s)
5. Stop controller

This mode is used when no persistent controller is running, allowing the CLI to operate independently.

### Persistent Mode

Long-running controller that stays active to handle multiple commands:

- Started with `launchpad start` (optionally detached with `-d`)
- Opens IPC socket for inter-process communication
- Stores PID in a file for tracking
- Handles multiple CLI commands without reinitializing
- Gracefully shuts down with `launchpad stop`

Subsequent `launchpad` commands (content, monitor, status) detect the running controller and communicate with it via IPC instead of creating ephemeral instances.

#### Benefits

- **Faster command execution**: No initialization overhead for subsequent commands
- **Shared state**: All commands operate against the same controller instance
- **Detached mode**: Can run in background with `-d` flag
- **IPC protocol**: Type-safe command execution and state queries
- **Graceful shutdown**: Multi-stage shutdown with IPC fallbacks (SIGTERM → SIGKILL)

## Type Safety

The controller uses TypeScript declaration merging to provide type-safe events without circular dependencies:

```typescript
// The controller declares system events
declare module '@bluecadet/launchpad-utils' {
  interface LaunchpadEvents {
    'system:shutdown': { code?: number; signal?: string };
    'content:fetch:start': { timestamp: Date };
    'monitor:app:started': { appName: string; pid: number };
  }
}
```
