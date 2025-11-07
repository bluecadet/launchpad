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
npm install @bluecadet/launchpad-monitor
```

## JS API Usage

```typescript
import { LaunchpadMonitor } from '@bluecadet/launchpad-monitor';

const monitor = new LaunchpadMonitor({
  apps: [
    {
      name: "my-app",
      pm2: {
        script: "./app.js"
      },
      windows: {
        foreground: true
      }
    }
  ]
});

// Start monitoring
await monitor.start();
```

## Configuration

Monitor operations are configured through a `MonitorConfig` object that specifies:

- **Apps**: Array of applications to manage
- **Process Settings**: PM2 configuration options
- **Window Management**: Window behavior settings
- **Logging Options**: Log handling preferences

See the [Monitor Config](./monitor-config) section for detailed configuration options.

## Error Handling

The package uses `neverthrow` for reliable error handling:

- Type-safe error management
- Graceful failure recovery
- Clear error reporting
- Process recovery strategies

## Plugin Support

The monitor package supports plugins for extending functionality:

- Custom process management
- Enhanced window control
- Additional monitoring capabilities
- Custom event handling
- Integration with other systems
