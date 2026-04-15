# Creating a Custom Plugin

This recipe explains how to create a custom plugin for Launchpad. Plugins are the primary extension point for the Launchpad controller — they receive a context on startup and can respond to commands, manage long-lived resources, and expose state to the system.

## Overview

Plugins in Launchpad:

- Are registered in the `plugins` array of your Launchpad config
- Receive a `PluginContext` during `setup()` with access to logging, events, and state management
- Can optionally handle commands dispatched to them
- Can optionally expose state to the dashboard and other plugins
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
import { defineConfig } from '@bluecadet/launchpad-cli';
import { myPlugin } from './my-plugin.js';

export default defineConfig({
  plugins: [myPlugin]
});
```

## Receiving Commands

Plugins can handle commands by implementing `executeCommand`. The controller routes all dispatched commands to plugins that implement this method.

> [!TIP]
> For production plugins, validate incoming commands with a [Zod](https://zod.dev) schema
> inside `executeCommand()` to catch malformed payloads at the boundary.

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { errAsync, okAsync } from 'neverthrow';

type GreetCommand = { type: 'greet'; name: string };

export const greetPlugin = definePlugin({
  name: 'greet-plugin',
  setup(ctx) {
    return okAsync({
      executeCommand(command: GreetCommand) {
        if (command.type === 'greet') {
          ctx.logger.info(`Hello, ${command.name}!`);
          return okAsync(undefined);
        }
        return errAsync(new Error(`Unknown command: ${command.type}`));
      }
    });
  }
});
```

### Dispatching Commands on Startup

Use `startupCommands` to automatically dispatch commands after all plugins are registered:

```typescript
export const greetPlugin = definePlugin({
  name: 'greet-plugin',
  startupCommands: [{ type: 'greet', name: 'World' }],
  setup(ctx) {
    return okAsync({
      executeCommand(command: GreetCommand) {
        // ...
      }
    });
  }
});
```

## Managing State

Plugins can expose state to the system by calling `ctx.updateState()`. The controller aggregates plugin states and broadcasts patches to any connected clients (e.g. the dashboard).

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

type CounterState = { count: number };

export const counterPlugin = definePlugin({
  name: 'counter-plugin',
  setup(ctx) {
    // Initialize state
    ctx.updateState((_draft: CounterState) => {
      return { count: 0 } as unknown as void;
    });

    return okAsync({
      executeCommand(command: { type: string }) {
        if (command.type === 'counter.increment') {
          ctx.updateState((draft: CounterState) => {
            draft.count += 1;
          });
          return okAsync(undefined);
        }
        return okAsync(undefined);
      }
    });
  }
});
```

>[!NOTE]
>Call `ctx.updateState()` with a complete initial value at the top of `setup()` to establish state. For subsequent updates, mutate the draft directly (Immer-style).

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
| `dispatchCommand` | Dispatch a command to any plugin |
| `updateState` | Update this plugin's state slice |
| `getGlobalState` | Read the full aggregated system state |
| `onGlobalStatePatch` | Subscribe to state patches across the system |
| `dashboardRegistry` | Dashboard contribution registry for panels, pages, scripts, styles, and routes |
| `statusRegistry` | Status section registry for CLI status renderers |

## Async Initialization

If your plugin needs to perform async work during setup (e.g. connecting to a database), do it inside `setup()` and return the result wrapped in `ResultAsync`:

```typescript
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { ResultAsync, okAsync } from 'neverthrow';

export const dbPlugin = definePlugin({
  name: 'db-plugin',
  setup(ctx) {
    return ResultAsync.fromPromise(
      connectToDatabase(),
      (e) => new Error(`Failed to connect: ${e}`)
    ).map((db) => ({
      executeCommand(command: { type: string }) {
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
2. **Return `ResultAsync`** from `setup()` — wrap async errors with `ResultAsync.fromPromise` rather than throwing
3. **Implement `disconnect()`** for any plugin that holds open handles or long-lived connections
4. **Use `abortSignal`** to cancel in-flight async work rather than ignoring it
5. **Prefer `dispatchCommand` over direct references** for cross-plugin coordination to keep plugins decoupled
6. **Never call `process.exit()`** from plugin code — emit a `system:shutdown` event via the event bus if the plugin needs to signal termination, and let the host process decide when to exit
7. **Never throw from plugin methods** — always return `errAsync()` or `err()` instead. Functions that return `ResultAsync` must never throw.

## Next Steps

- Explore [Built-in Plugins](../reference/content/index.md) for real-world examples
- See the [Plugin Interfaces Reference](../reference/plugin-interfaces.md) for full API details
- Learn about [Content Sources](../reference/content/sources/index.md) and [Content Transforms](../reference/content/transforms/index.md) for content-specific extension points
