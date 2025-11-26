# Creating a Custom Monitor Plugin

This recipe walks through creating a custom monitor plugin for Launchpad's process monitoring system. Monitor plugins let you hook into process lifecycle events and add custom functionality to your process management.

## Overview

Monitor plugins in Launchpad:

- React to process lifecycle events (start, stop, errors, etc.)
- Can modify or enhance monitoring behavior
- Have access to the monitor instance and its utilities
- Run in the order they are defined in your config

## Basic Plugin Structure

Here's a minimal plugin example:

```typescript
const myPlugin = {
  name: 'my-monitor-plugin',
  hooks: {
    afterAppStart: async (ctx) => {
      // Your logic here
    }
  }
}
```

## Step-by-Step Example

Let's create a plugin that logs app restarts and sends notifications:

```typescript
const restartNotifierPlugin = {
  name: 'restart-notifier',
  hooks: {
    // Runs after an app starts
    afterAppStart: async ({ logger }) => {
      logger.info('An app has started successfully.');
    },

    // Runs when an app encounters an error
    onAppError: async ({ app, error, logger }) => {
      logger.error(
        `Error in ${app.name}: ${error.message}`
      );
    }
  }
}
```

Add it to your Launchpad config:

```typescript
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  monitor: {
    apps: [ /* your apps */ ],
    plugins: [
      restartNotifierPlugin
    ]
  }
});
```

## Available Hooks

Monitor plugins can use these hooks:

- `beforeConnect`/`afterConnect`: PM2 connection lifecycle
- `beforeDisconnect`/`afterDisconnect`: PM2 disconnection lifecycle
- `beforeAppStart`/`afterAppStart`: App start lifecycle
- `beforeAppStop`/`afterAppStop`: App stop lifecycle
- `onAppError`: App errors
- `onAppLog`/`onAppErrorLog`: App logging
- `beforeShutdown`: System shutdown

>[!TIP]
>Choose hooks based on what events you need to monitor. Most monitoring logic will use the app lifecycle hooks.

## Working with the Context

Each hook receives a context object with useful utilities:

```typescript
const myPlugin = {
  name: 'my-plugin',
  hooks: {
    afterAppStart: async (ctx) => {
      const {
        logger,      // Plugin-specific logging
        app         // The current app (in app-specific hooks)
      } = ctx;

      // Example: Log app status
      logger.info(`App ${app.name} is running`);
    }
  }
}
```

## Best Practices

1. **Name your plugin clearly**: Use a descriptive, unique name
2. **Handle errors gracefully**: Use try/catch blocks
3. **Log important events**: Use the provided logger
4. **Clean up resources**: Handle cleanup in shutdown hooks
5. **Keep it focused**: One responsibility per plugin

```typescript
const bestPracticePlugin = {
  name: 'best-practice-plugin',
  hooks: {
    afterAppStart: async ({ app, logger }) => {
      try {
        logger.info(`Monitoring app: ${app.name}`);
        // Your logic here...
      } catch (error) {
        logger.error('Plugin failed:', error);
        throw error; // Re-throw to notify Launchpad
      }
    },
    
    beforeShutdown: async ({ logger }) => {
      // Clean up resources
      logger.info('Cleaning up...');
    }
  }
}
```

## Going Further

- See [Monitor Plugin Reference](../reference/monitor/plugins.md) for complete API details
- Check [Monitor Reference](../reference/monitor/index.md) for monitor documentation
- Explore example plugins for real-world usage

>[!NOTE]
>Remember to test your plugins thoroughly, especially error handling and cleanup logic.
