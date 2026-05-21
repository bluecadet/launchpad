---
title: "@bluecadet/launchpad-monitor"
---

<script setup>
  import PackageHeader from '../../components/PackageHeader.vue'
</script>

<PackageHeader package="monitor" />

The monitor package is a robust process management and monitoring tool designed for media installations. It provides comprehensive control over application lifecycles, window management, and system monitoring.

## Features

- **Process Management**: Complete control over application lifecycles:
  - Launch and monitor multiple applications
  - Automatic crash recovery
  - Graceful shutdowns and restarts
  - PM2 integration for advanced process control

- **Window Management**: Powerful window control capabilities:
  - Move windows to foreground/background
  - Minimize/maximize operations
  - Window visibility control

- **Logging System**: Comprehensive logging features:
  - Centralized log collection
  - Configurable log routing
  - stdout/stderr capture
  - Log file management
  - Debug and error tracking

- **Event System**: Flexible event handling:
  - Process lifecycle hooks
  - Plugin event integration

## Installation

```bash
npm install @bluecadet/launchpad
```

## JS API Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { monitor } from '@bluecadet/launchpad/monitor';

export default defineConfig({
  plugins: [
    monitor({
      apps: [
        {
          pm2: {
            name: 'my-app',
            script: './app.js',
          },
          windows: {
            foreground: true,
          },
        },
      ],
    }),
  ],
  workflows: {
    start: ['monitor.connect', 'monitor.start'],
    stop: ['monitor.stop', 'monitor.disconnect'],
  },
});
```

## Configuration

Monitor operations are configured through a `MonitorConfig` object that specifies:

- **Apps**: Array of applications to manage
- **Process Settings**: PM2 configuration options
- **Window Management**: Window behavior settings
- **Logging Options**: Log handling preferences

See the [Monitor Config](./monitor-config) section for detailed configuration options.

## License Note

The monitor package depends on PM2, which is licensed under AGPL-3.0. PM2's license does not make applications managed by PM2 become AGPL-licensed, but it does matter if you redistribute PM2, modify PM2 itself, or work under an organizational policy that restricts AGPL dependencies.

Bluecadet-authored Launchpad code is licensed under ISC. Third-party dependencies retain their own licenses.

## Error Handling

The package uses `neverthrow` for reliable error handling:

- Type-safe error management
- Graceful failure recovery
- Clear error reporting
- Process recovery strategies

## Extension Points

Custom Launchpad plugins can subscribe to monitor events and dispatch monitor commands through the controller. See [Extending Monitor](./plugins.md) for the current extension model.
