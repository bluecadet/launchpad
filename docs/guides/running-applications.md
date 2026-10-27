# Running applications

Launchpad's monitor launches long-running applications and keeps them running. This guide covers configuring, launching, and monitoring them.

## Overview

The monitor runs on [PM2](https://pm2.keymetrics.io/) and provides:

- Process management and auto-restart
- Log collection and rotation
- Application status monitoring
- Graceful shutdown

## Basic setup

1. Install the package:

```bash
npm install @bluecadet/launchpad
```

2. Configure your applications in `launchpad.config.js`:

```js
import { defineConfig } from '@bluecadet/launchpad/cli';
import { monitor } from '@bluecadet/launchpad/monitor';

export default defineConfig({
  plugins: [
    monitor({
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
    })
  ]
});
```

>[!WARNING]
>Test your configuration in a development environment first.

3. Start your application:

```bash
npx launchpad monitor start
```

## Configuration options

### Basic settings

- `name`: Unique identifier for the application
- `script`: Path to the executable or script
- `cwd`: Working directory for the application. Relative paths resolve against Launchpad's working directory.

### Advanced settings

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

## Best practices

- Give each application a unique, descriptive name.
- Configure restart policies.
- Set memory limits to prevent system overload.
- Use log levels suited to debugging.

## Next steps

- [Fetching content](./fetching-content.md)
- [Monitor reference](../reference/monitor/index.md) for the full API
