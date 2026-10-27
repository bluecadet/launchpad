# Extending monitor

To extend the monitor, register custom behavior as a Launchpad plugin and subscribe to monitor lifecycle events on the shared event bus. This model replaces the old `MonitorPlugin` hook system.

## Custom plugins

Create a plugin with `definePlugin()` from `@bluecadet/launchpad/utils/plugin-interfaces`, then add it to the `plugins` array in `launchpad.config.ts`.

```ts
import { definePlugin } from '@bluecadet/launchpad/utils/plugin-interfaces';
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
> If your plugin handles commands, declare them in `manifest.commands`. Launchpad doesn't route commands by name prefix.

## Available events

Subscribe to monitor lifecycle events through `ctx.eventBus` in your plugin's `setup()` function. See [Monitor events](./events.md) for the full list.
