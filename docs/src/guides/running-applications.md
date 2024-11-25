# Running Applications

Launchpad's monitoring system helps you manage and maintain long-running applications reliably. This guide covers how to configure, launch, and monitor your applications using Launchpad.

## Overview

The monitoring system is built on top of [PM2](https://pm2.keymetrics.io/), a robust process manager, providing:

- Process management and auto-restart
- Log collection and rotation
- Application status monitoring
- Graceful shutdown handling

## Basic Setup

1. Install the required packages:

```bash
npm install @bluecadet/launchpad-cli @bluecadet/launchpad-monitor
```

2. Configure your applications in `launchpad.config.js`:

```js
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  monitor: {
    apps: [
      {
        pm2: {
          name: "my-app",
          script: "./app.exe",
          cwd: "./builds/",
          // Optional: environment variables
          env: {
            PORT: "3000"
          }
        }
      }
    ]
  }
});
```

>[!WARNING]
>Always test your configuration in a development environment first

3. Start your application

```bash
npx launchpad monitor start
```

## Configuration Options

### Basic Settings

- `name`: Unique identifier for your application
- `script`: Path to your executable or script
- `cwd`: Working directory for your application

### Advanced Settings

```js
{
  pm2: {
    // Process settings
    autorestart: true,
    
    // Resource limits
    max_memory_restart: '1G',
    
    // Environment
    env: {
      NODE_ENV: 'production'
    }
  }
}
```

## Best Practices

1. **Unique Names**: Give each application a unique, descriptive name
2. **Error Handling**: Configure proper restart policies
3. **Resource Limits**: Set memory limits to prevent system overload
4. **Logging**: Use appropriate log levels for debugging

## Next Steps

- Learn about [content management](./fetching-content.md)
- Explore [system configuration](./configuring-windows.md)
- Read the [monitor reference](../reference/monitor/index.md) for detailed API documentation
