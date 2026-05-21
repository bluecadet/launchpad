# @bluecadet/launchpad-monitor

Process monitoring and management for interactive installations. Part of the Launchpad suite of tools.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad>

## Features

- Process management via PM2
- Launchpad plugin integration for custom monitoring behavior
- Process lifecycle hooks
- Built-in logging and error handling
- Window management capabilities

## Installation

```bash
npm install @bluecadet/launchpad-monitor
```

## Basic Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad-cli';
import { monitor } from '@bluecadet/launchpad-monitor';

export default defineConfig({
  plugins: [
    monitor({
      apps: [
        {
          pm2: {
            name: 'my-app',
            script: 'app.js',
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

## License

ISC © Bluecadet
