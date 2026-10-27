# @bluecadet/launchpad-monitor

Process monitoring and management for interactive installations, part of the Launchpad suite.

## Documentation

See the [Launchpad documentation](https://bluecadet.github.io/launchpad) for examples and the API reference.

## Features

- Process management through PM2
- Launchpad plugins for custom monitoring behavior
- Process lifecycle hooks
- Built-in logging and error handling
- Window management

## Installation

```bash
npm install @bluecadet/launchpad-monitor
```

## Basic usage

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

This package depends on PM2, which is licensed under AGPL-3.0. Review PM2's license terms before using, deploying, or redistributing this package.

PM2's license does not make the applications it manages AGPL-licensed. It affects compliance for the PM2 dependency itself:

- If you redistribute a bundle, installer, or machine image that includes PM2, preserve PM2's license notices and be prepared to provide PM2 source as its license requires.
- If you modify PM2, those changes carry AGPL obligations, including source availability for users who interact with the modified PM2 over a network.
- Some organizations restrict AGPL dependencies. If yours does, review the monitor package before adopting it, or install only the Launchpad packages you need.

This summary is not legal advice.
