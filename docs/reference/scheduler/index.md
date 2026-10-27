---
title: "Scheduler"
---
The scheduler plugin dispatches registered Launchpad commands through the controller on interval or cron schedules. It works with any command id.

For a complete content-refresh setup, see the [live content refresh recipe](../../recipes/live-content-refresh.md).

## Installation

The Launchpad umbrella package includes the scheduler:

```bash
npm install @bluecadet/launchpad
```

## Minimal configuration

Add `scheduler()` to your Launchpad config. This example runs `content.fetch` every five minutes. By default, failed dispatches retry indefinitely with exponential backoff.

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { scheduler } from '@bluecadet/launchpad/scheduler';

export default defineConfig({
  plugins: [scheduler({ 'content.fetch': '5m' })],
});
```

The first run happens one interval after startup. Set `runOnStart: true` to also run a job immediately.

See [Scheduler config](/reference/scheduler/scheduler-config/) for all scheduling options and [Commands & events](./commands.md) for runtime control and status output.
