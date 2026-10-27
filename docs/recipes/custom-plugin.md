# Creating a custom plugin

Plugins are the main way to extend the Launchpad controller. A plugin receives a context on startup and can respond to commands, manage long-lived resources, and expose state.

## Overview

Plugins:

- Are registered in the `plugins` array of your Launchpad config
- Receive a `PluginContext` in `setup()` with logging, events, and state management

Optionally, a plugin can:

- Handle commands dispatched to it
- Expose state to status output and other plugins
- Run startup work after every plugin is set up
- Clean up on shutdown

## Basic plugin structure

Create a plugin with `definePlugin` from `@bluecadet/launchpad/utils/plugin-interfaces`:

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

## Typed plugin options

For plugin options, write a documented interface and bind your Zod schema to it with `configSchema`. Editors then show the interface's comments in `launchpad.config.ts`. A type inferred with `z.input<typeof schema>` loses those comments once the plugin is compiled.

```typescript
import { configSchema } from '@bluecadet/launchpad/utils/config-schema';
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
import { okAsync } from 'neverthrow';
import { z } from 'zod';

export interface GreeterOptions {
  /** Name to greet on startup. Defaults to `"world"`. */
  name?: string;
}

const greeterOptionsSchema = configSchema<GreeterOptions>()(
  z.object({ name: z.string().default('world') })
);

export function greeter(options: GreeterOptions = {}) {
  const { name } = greeterOptionsSchema.parse(options);
  return definePlugin({
    name: 'greeter',
    setup(ctx) {
      ctx.logger.info(`Hello, ${name}!`);
      return okAsync({});
    }
  });
}
```

`configSchema` fails type-checking when the schema's input type no longer matches the interface.

## Receiving commands

To handle commands, declare them in `manifest.commands` and implement `executeCommand()`. The controller dispatches only commands registered through the manifest.

> [!TIP]
> In production plugins, validate incoming commands with a [Zod](https://zod.dev) schema:
> attach it to `manifest.commands` and validate again inside `executeCommand()` as needed.

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

### Declaring startup and shutdown workflows

Plugins declare commands; hosts decide when they run:

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

## Managing state

Call `ctx.updateState()` to expose plugin state. The controller aggregates plugin states and broadcasts patches to connected IPC clients.

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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
>At the top of `setup()`, call `ctx.updateState()` with a complete initial value. For later updates, mutate the draft directly (Immer-style).

## Contributing status output

To appear in `launchpad status`, add a `summarize()` hook to the plugin config. The hook receives the aggregated Launchpad state and returns a `Section`, or `null` when the plugin has nothing to show.

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

## Reacting to events

Use `eventBus` to listen for events from other plugins or the system:

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

## Startup work that needs other plugins

`setup()` runs sequentially in registration order, so plugins registered later miss any event a plugin emits during its own setup. Implement `ready()` for startup work that needs the rest of the system. Once every plugin is set up, the controller calls each plugin's `ready()` in registration order, waiting for one to complete before starting the next.

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

export const announcerPlugin = definePlugin({
  name: 'announcer-plugin',
  setup(ctx) {
    return okAsync({
      ready() {
        // Every plugin — including transports that subscribe during their own setup —
        // is listening by now.
        ctx.eventBus.emit('announcer-plugin.ready', { at: Date.now() });
        return okAsync(undefined);
      }
    });
  }
});
```

A failed `ready()` is logged and contained. It never fails startup, and the remaining plugins still become ready. A plugin registered after the ready phase, such as one a host adds at runtime, has its `ready()` called immediately after `setup()`.

## Cleanup on shutdown

Implement `disconnect()` to release long-lived resources such as connections, child processes, and timers. The controller calls `disconnect()` after the abort signal fires.

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

## The plugin context

The `PluginContext` passed to `setup()` provides:

| Property | Description |
|---|---|
| `logger` | Logger instance for structured output |
| `eventBus` | Event bus for cross-plugin communication |
| `abortSignal` | Fires when Launchpad is shutting down |
| `cwd` | Working directory |
| `mode` | The controller's run mode (`"task" \| "persistent"`) |
| `getStatusSnapshot` | Build the display status snapshot from every plugin's `summarize()`. Use sparingly |
| `dispatchCommand` | Dispatch a registered command to another plugin |
| `updateState` | Update this plugin's state slice |
| `getGlobalState` | Read the full aggregated system state |
| `onGlobalStatePatch` | Subscribe to state patches across the system |

## Async initialization

Do async setup work, such as connecting to a database, inside `setup()` and return the result wrapped in `ResultAsync`:

```typescript
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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

## Best practices

1. Choose a unique name. Plugin names appear in logs and state aggregation.
2. Declare handled commands in `manifest.commands`.
3. Keep startup behavior in host workflows.
4. Use `summarize()` for `launchpad status` output instead of mutating controller-owned status registries.
5. Return `ResultAsync` from `setup()`, wrapping async errors with `ResultAsync.fromPromise` instead of throwing.
6. Use `ready()` for cross-plugin startup work.
7. Implement `disconnect()` in any plugin that holds open handles or long-lived connections.
8. Use `abortSignal` to cancel in-flight async work.
9. Coordinate with other plugins through `dispatchCommand` instead of direct references.
10. Never call `process.exit()`. To signal termination, emit a `system:shutdown` event on the event bus and let the host decide when to exit.
11. Never throw from plugin methods. Return `errAsync()` or `err()` instead; functions that return `ResultAsync` must never throw.

## Migration notes

To update an older plugin:

- Move handled commands into `manifest.commands`.
- Move automatic startup behavior into host-level `workflows`.
- Replace status registry usage with a plugin-level `summarize()` hook.
- Stop relying on prefix-based routing; `my-plugin.*` commands are no longer dispatched automatically.
- Return an `executeCommand()` implementation from `setup()` in any plugin that declares `manifest.commands`.

## Next steps

- [Content plugin reference](../reference/content/index.md) for a built-in example
- [Controller reference](/reference/controller/) for plugin contract details
- [Content sources](../reference/content/sources/index.md) and [content transforms](../reference/content/transforms/index.md) for content-specific extension points
