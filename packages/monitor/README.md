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

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.

This package depends on PM2, which is licensed under AGPL-3.0. Review PM2's license terms when using, deploying, or redistributing this package.

In practice, PM2's license does not make applications managed by PM2 become AGPL-licensed. The main impact is on compliance for the PM2 dependency itself:

- If you redistribute a bundle, installer, or machine image that includes PM2, preserve PM2's license notices and be prepared to provide PM2 source as required by its license.
- If you modify PM2 itself, expect those PM2 changes to carry AGPL obligations, including source availability for users who interact with the modified PM2 over a network.
- Some organizations restrict AGPL dependencies. If that applies to your project, review the monitor package before adopting it or install only the Launchpad packages you need.

This is a practical summary, not legal advice.
