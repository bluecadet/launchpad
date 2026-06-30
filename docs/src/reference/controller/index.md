## Integration with Subsystems

Plugins integrate with the controller through two complementary contracts:

**Plugin properties** — capabilities the plugin *offers* to the controller:

```typescript
type InstantiatedPlugin<TCommand> = Partial<
  CommandExecutor<TCommand> &  // Execute commands
  Disconnectable               // Clean disconnect
>;
```

**Plugin config** — controller-owned metadata and lifecycle hooks:

```typescript
interface PluginConfig<TCommand, TState> {
  name: string;
  manifest?: PluginManifest<TCommand>;
  setup(ctx: PluginContext<TState>): ResultAsync<InstantiatedPlugin<TCommand>, Error>;
  summarize?(state: LaunchpadState): Section | null;
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

### Host-Owned Workflows

Hosts declare startup and shutdown orchestration in config and hand it to the controller:

```typescript
export default defineConfig({
  plugins: [content({}), monitor({})],
  workflows: {
    start: ['content.fetch', 'monitor.connect', 'monitor.start'],
  },
});
```

The controller exposes `setWorkflows()` and `runWorkflow()` so every host can run the same named workflow sequence. `LaunchpadController.stop()` automatically runs the `stop` workflow before plugin disconnects.

#### Step failure handling

Workflows run every step **best-effort**. If a step fails, the controller records the error, emits `workflow:step:error`, and continues with the remaining steps. After all steps run, the workflow reports an aggregated failure (`workflow:error`) if any step errored.

This means a failed `content.fetch` no longer prevents `monitor.start` from launching apps — content fetching stages its output before promoting it, so the previously-published content remains on disk and the monitor runs against the last good content.

To make a step fatal — halting the workflow and skipping the remaining steps when it fails — wrap it in an object with `stopOnError`:

```typescript
export default defineConfig({
  workflows: {
    // 'publish' is skipped if 'build' fails
    deploy: [{ step: 'build', stopOnError: true }, 'publish'],
  },
});
```

### State Management

Plugins own their domain logic; the controller owns the state infrastructure. Plugins call `ctx.updateState()` to establish and mutate their state slice — the controller lazily creates a scoped store on first call and handles patch generation, versioning, and broadcasting.

To read the full aggregated state (all plugins + system), use `ctx.getGlobalState()`. Prefer `ctx.eventBus` or `ctx.dispatchCommand` for cross-plugin communication over polling global state.

### Status Snapshots

Plugins can contribute to `launchpad status` by adding a `summarize(state)` function to their plugin config. The controller calls every registered plugin's `summarize()` hook, drops `null` results, sorts the returned sections by `order`, and sends the resulting status snapshot over IPC.

```typescript
import type { LaunchpadState, Section } from '@bluecadet/launchpad-utils/types';

definePlugin({
  name: 'my-plugin',
  setup(ctx: PluginContext<MyState>) {
    ctx.updateState(() => ({ ready: false }));
    return okAsync({});
  },
  summarize(state: LaunchpadState): Section | null {
    const pluginState = state.plugins['my-plugin'] as MyState | undefined;
    if (!pluginState) return null;

    return {
      name: 'my-plugin',
      title: 'My Plugin',
      rows: [{ type: 'kv', label: 'Ready', value: pluginState.ready ? 'Yes' : 'No' }],
    };
  },
});
```

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

The controller uses TypeScript declaration merging against `@bluecadet/launchpad-utils/types` to provide type-safe events without circular dependencies:

```typescript
// The controller declares system events
declare module '@bluecadet/launchpad-utils/types' {
  interface LaunchpadEvents {
    'system:shutdown': { code?: number; signal?: string };
    'content:fetch:start': { timestamp: Date };
    'monitor:app:started': { appName: string; pid: number };
  }
}
```
