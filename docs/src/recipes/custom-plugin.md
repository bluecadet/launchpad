# Creating a Custom Plugin

This recipe explains how to create a custom plugin for Launchpad. Plugins are the primary extension point for the Launchpad controller — they receive a context on startup and can respond to commands, manage long-lived resources, and expose state to the system.

## Overview

Plugins in Launchpad:

- Are registered in the `plugins` array of your Launchpad config
- Receive a `PluginContext` during `setup()` with access to logging, events, and state management
- Can optionally handle commands dispatched to them
- Can optionally expose state to status output and other plugins
- Can optionally perform cleanup on shutdown

## Basic Plugin Structure

A plugin is created with `definePlugin` from `@bluecadet/launchpad-utils/plugin-interfaces`:

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

export const myPlugin = definePlugin({
  name: 'my-plugin',
  setup(ctx) {
    ctx.logger.info('My plugin is starting up!');
    return okAsync({});
  }
});
```

Add it to your Launchpad config:

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { myPlugin } from './my-plugin.js';

export default defineConfig({
  plugins: [myPlugin]
});
```

## Receiving Commands

Plugins that handle commands should declare them explicitly in `manifest.commands` and implement `executeCommand()`. The controller only dispatches commands that have been registered through the manifest.

> [!TIP]
> For production plugins, validate incoming commands with a [Zod](https://zod.dev) schema
> by attaching the schema to `manifest.commands` and validating again inside `executeCommand()` as needed.

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

type GreetCommand = { type: 'greet-plugin.greet'; name: string };

const greetCommandSchema = z.object({
  type: z.literal('greet-plugin.greet'),
  name: z.string(),
}).strict();

export const greetPlugin = definePlugin({
  name: 'greet-plugin',
  manifest: {
    commands: [
      {
        id: 'greet-plugin.greet',
        parser: greetCommandSchema,
      },
    ],
  },
  setup(ctx) {
    return okAsync({
      executeCommand(command: GreetCommand) {
        const parsed = greetCommandSchema.safeParse(command);
        if (!parsed.success) {
          return errAsync(new Error(`Invalid command: ${parsed.error.message}`));
        }

        ctx.logger.info(`Hello, ${parsed.data.name}!`);
        return okAsync(undefined);
      }
    });
  }
});
```

### Declaring Startup and Shutdown Workflows

Plugins should declare commands, while hosts decide when those commands run:

```typescript
export default defineConfig({
  plugins: [greetPlugin],
  workflows: {
    start: [{ type: 'greet-plugin.greet', name: 'World' }],
  },
});
```

> [!IMPORTANT]
> Launchpad no longer infers command ownership from the command type prefix. Plugins declare commands in `manifest.commands`; hosts declare orchestration in `workflows` and hand it to the controller.

## Managing State

Plugins can expose state to the system by calling `ctx.updateState()`. The controller aggregates plugin states and broadcasts patches to connected IPC clients.

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

type CounterCommand = { type: 'counter-plugin.increment' };
type CounterState = { count: number };

export const counterPlugin = definePlugin({
  name: 'counter-plugin',
  manifest: {
    commands: [{ id: 'counter-plugin.increment' }],
  },
  setup(ctx) {
    // Initialize state
    ctx.updateState((_draft: CounterState) => {
      return { count: 0 } as unknown as void;
    });

    return okAsync({
      executeCommand(command: CounterCommand) {
        if (command.type === 'counter-plugin.increment') {
          ctx.updateState((draft: CounterState) => {
            draft.count += 1;
          });
        }
        return okAsync(undefined);
      }
    });
  }
});
```

>[!NOTE]
>Call `ctx.updateState()` with a complete initial value at the top of `setup()` to establish state. For subsequent updates, mutate the draft directly (Immer-style).

## Contributing Status Output

Plugins that want to appear in `launchpad status` can add a `summarize()` hook to their plugin config. The hook receives the aggregated Launchpad state and returns a `Section`, or `null` when the plugin has no status to show.

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import type { LaunchpadState, Section } from '@bluecadet/launchpad-utils/types';
import { okAsync } from 'neverthrow';

type CounterState = { count: number };

export const counterPlugin = definePlugin({
  name: 'counter-plugin',
  setup(ctx) {
    ctx.updateState(() => ({ count: 0 }));
    return okAsync({});
  },
  summarize(state: LaunchpadState): Section | null {
    const counterState = state.plugins['counter-plugin'] as CounterState | undefined;
    if (!counterState) return null;

    return {
      name: 'counter-plugin',
      title: 'Counter',
      rows: [{ type: 'kv', label: 'Count', value: String(counterState.count) }],
    };
  },
});
```

## Reacting to Events

The `eventBus` provides cross-plugin event communication. Listen for events emitted by other plugins or the system:

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

export const listenerPlugin = definePlugin({
  name: 'listener-plugin',
  setup(ctx) {
    ctx.eventBus.on('content:fetch:start', (data) => {
      ctx.logger.info('Content fetch started!', data);
    });

    return okAsync({});
  }
});
```

## Cleanup on Shutdown

Implement `disconnect()` to release long-lived resources (connections, child processes, timers) when Launchpad shuts down. The controller calls `disconnect()` after the abort signal fires.

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

export const resourcePlugin = definePlugin({
  name: 'resource-plugin',
  setup(ctx) {
    let interval: ReturnType<typeof setInterval> | null = null;

    interval = setInterval(() => {
      ctx.logger.debug('Tick');
    }, 5000);

    return okAsync({
      disconnect() {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        ctx.logger.info('Resource plugin disconnected');
        return okAsync(undefined);
      }
    });
  }
});
```

## The Plugin Context

The `PluginContext` passed to `setup()` provides:

| Property | Description |
|---|---|
| `logger` | Logger instance for structured output |
| `eventBus` | Event bus for cross-plugin communication |
| `abortSignal` | Fires when Launchpad is shutting down |
| `cwd` | Working directory |
| `dispatchCommand` | Dispatch a registered command to another plugin |
| `updateState` | Update this plugin's state slice |
| `getGlobalState` | Read the full aggregated system state |
| `onGlobalStatePatch` | Subscribe to state patches across the system |

## Async Initialization

If your plugin needs to perform async work during setup (e.g. connecting to a database), do it inside `setup()` and return the result wrapped in `ResultAsync`:

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { ResultAsync, okAsync } from 'neverthrow';

type DbCommand = { type: 'db-plugin.ping' };

export const dbPlugin = definePlugin({
  name: 'db-plugin',
  manifest: {
    commands: [{ id: 'db-plugin.ping' }],
  },
  setup(ctx) {
    return ResultAsync.fromPromise(
      connectToDatabase(),
      (e) => new Error(`Failed to connect: ${e}`)
    ).map((db) => ({
      executeCommand(command: DbCommand) {
        // use db here
        return okAsync(undefined);
      },
      disconnect() {
        return ResultAsync.fromPromise(db.close(), (e) => e as Error);
      }
    }));
  }
});
```

## Best Practices

1. **Choose a unique name**: Plugin names appear in logs and state aggregation
2. **Declare handled commands in `manifest.commands`**: command execution is explicit and controller-owned
3. **Keep startup behavior in host workflows**: plugins expose commands, and hosts decide when to run them
4. **Use `summarize()`** for `launchpad status` output instead of mutating controller-owned status registries
5. **Return `ResultAsync`** from `setup()` — wrap async errors with `ResultAsync.fromPromise` rather than throwing
6. **Implement `disconnect()`** for any plugin that holds open handles or long-lived connections
7. **Use `abortSignal`** to cancel in-flight async work rather than ignoring it
8. **Prefer `dispatchCommand` over direct references** for cross-plugin coordination to keep plugins decoupled
9. **Never call `process.exit()`** from plugin code — emit a `system:shutdown` event via the event bus if the plugin needs to signal termination, and let the host process decide when to exit
10. **Never throw from plugin methods** — always return `errAsync()` or `err()` instead. Functions that return `ResultAsync` must never throw.

## Migration Notes

If you are updating an older plugin:

- move handled commands into `manifest.commands`
- move any automatic startup behavior into host-level `workflows`
- replace status registry usage with a plugin-level `summarize()` hook
- stop relying on implicit prefix-based routing such as assuming `my-plugin.*` commands will be dispatched automatically
- ensure any plugin that declares `manifest.commands` returns an `executeCommand()` implementation from `setup()`

## Next Steps

- Explore [Built-in Plugins](../reference/content/index.md) for real-world examples
- See the [Controller Reference](../reference/controller/index.md) for plugin contract details
- Learn about [Content Sources](../reference/content/sources/index.md) and [Content Transforms](../reference/content/transforms/index.md) for content-specific extension points
