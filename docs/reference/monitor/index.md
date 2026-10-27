---
title: "@bluecadet/launchpad-monitor"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/monitor) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-monitor) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/monitor/CHANGELOG.md)

The monitor package supervises processes for media installations. It controls application lifecycles, window placement, and system monitoring.

## Features

- Process management:
  - Launch and monitor multiple applications
  - Restart apps that crash
  - Shut down and restart gracefully
  - Control processes through PM2
- Window management (Windows only):
  - Bring windows to the foreground
  - Minimize windows
  - Hide windows
- Logging:
  - Collect logs in one place
  - Route logs by configuration
  - Capture stdout and stderr
  - Manage log files
- Events:
  - Process lifecycle events
  - Integration with plugins

## Installation

```bash
npm install @bluecadet/launchpad
```

### Windows window management

The monitor package ships a precompiled Node-API addon for Windows x64 and arm64. Installation needs no Python, MSVC, or `node-gyp`, and it neither builds native code nor downloads binaries. The arm64 binary is cross-compiled; its runtime behavior on Windows arm64 is unverified.

Window management runs only on Windows. Other platforms keep PM2 process management and logging. Native window actions run asynchronously and don't block Node's event loop. Windows can deny requests to bring an application to the foreground, so `foreground: true` is best-effort.

On managed Windows systems, native library policies may require signing or allowlisting the bundled `.node` file. If loading it is blocked, check with your administrator. There is no fallback that builds from source.

Rebuild instructions and release verification steps are in the [native addon README](https://github.com/bluecadet/launchpad/blob/main/packages/monitor/native/README.md).

## JS API usage

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

A `MonitorConfig` object configures the monitor. It specifies:

- The applications to manage
- PM2 process settings
- Window behavior
- Log handling

See [Monitor config](/reference/monitor/monitor-config/) for every option.

## License note

The monitor package depends on PM2, which is licensed under AGPL-3.0. Applications that PM2 manages don't become AGPL-licensed. The license does matter if you redistribute or modify PM2, or if your organization restricts AGPL dependencies.

Bluecadet-authored Launchpad code is licensed under ISC. Third-party dependencies retain their own licenses.

## Error handling

The package uses `neverthrow` for typed error handling:

- Type-safe error management
- Graceful failure recovery
- Clear error reporting
- Process recovery strategies

## Extension points

Custom Launchpad plugins can subscribe to monitor events and dispatch monitor commands through the controller. See [Extending monitor](./plugins.md).
