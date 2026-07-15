---
title: "Scheduler"
---

# Scheduler

The scheduler plugin dispatches registered Launchpad commands on interval or cron schedules. It is command-agnostic: configure a command id and the scheduler dispatches that command through the controller.

For a complete content-refresh setup, see the [Live Content Refresh recipe](/recipes/live-content-refresh).

## Installation

The scheduler is included with the Launchpad umbrella package:

```bash
npm install @bluecadet/launchpad
```

## Minimal configuration

Add `scheduler()` to your Launchpad config. This schedules `content.fetch` every five minutes. The default retry policy keeps retrying failed dispatches with exponential backoff.

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { scheduler } from '@bluecadet/launchpad/scheduler';

export default defineConfig({
  plugins: [scheduler({ 'content.fetch': '5m' })],
});
```

The first run is one interval after startup. Set `runOnStart: true` for a job that should also run immediately.

See [Scheduler Config](./scheduler-config) for all scheduling options and [Commands & Events](./commands) for runtime control and status output.
