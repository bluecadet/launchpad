# Extending Monitor

The old `MonitorPlugin` hook system has been replaced by a two-part model: registering custom behavior as a launchpad plugin, and subscribing to monitor lifecycle events on the shared event bus.

## Custom Plugins

Use `definePlugin()` from `@bluecadet/launchpad-utils/plugin-interfaces` to create a plugin, then register it in the `plugins` array in `launchpad.config.ts`.

```ts
import { definePlugin } from '@bluecadet/launchpad-utils/plugin-interfaces';
import { okAsync } from 'neverthrow';

const myMonitorPlugin = definePlugin({
  name: 'my-monitor-plugin',
  manifest: {
    commands: [{ id: 'my-monitor-plugin.refresh' }],
  },
  setup(ctx) {
    ctx.eventBus.on('monitor:app:log', ({ appName, data }) => {
      // handle log
    });
    ctx.eventBus.on('monitor:app:error', ({ appName, error }) => {
      // handle error
    });
    return okAsync({
      executeCommand(command) {
        if (command.type === 'my-monitor-plugin.refresh') {
          return okAsync(undefined);
        }
        return okAsync(undefined);
      },
    });
  }
});
```

## Registering in `launchpad.config.ts`

```ts
import { monitor } from '@bluecadet/launchpad/monitor';

export default {
  plugins: [
    monitor({ apps: [...] }),
    myMonitorPlugin,
  ]
};
```

> [!IMPORTANT]
> If your plugin handles commands, declare them in `manifest.commands`. Launchpad no longer routes commands implicitly based on command name prefixes.

## Available Events

Subscribe to any monitor lifecycle event in your plugin's `setup()` function via `ctx.eventBus`. See the [Monitor Events](./events.md) page for the full list of available events.
