# @bluecadet/launchpad-monitor

Process monitoring and management for interactive installations. Part of the Launchpad suite of tools.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad>

## Features

- Process management via PM2
- Plugin system for custom monitoring behavior
- Process lifecycle hooks
- Built-in logging and error handling
- Window management capabilities

## Installation

```bash
npm install @bluecadet/launchpad-monitor
```

## Basic Usage

```typescript
import { Monitor } from '@bluecadet/launchpad-monitor';

const monitor = new Monitor({
  apps: [{
    name: 'my-app',
    script: 'app.js'
  }]
});

await monitor.start();
```

## License

ISC © Bluecadet
