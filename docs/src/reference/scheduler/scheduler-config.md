---
title: "Scheduler Config"
---

# Scheduler Config

Pass a command-keyed record to `scheduler()`. Each key identifies the command to dispatch; one command id can have one schedule.

```typescript
scheduler({
  'content.fetch': '5m',
  'content.clear': { cron: '0 3 * * *' },
});
```

> [!NOTE]
> Multiple independent schedules for the same command id are not supported. The record shape allows one schedule per key.

For a complete content-refresh setup, see the [Live Content Refresh recipe](/recipes/live-content-refresh).

## Schedule shorthand

A bare string is either a duration or a cron expression:

- A string with no whitespace is a duration, such as `'500ms'`, `'30s'`, `'5m'`, or `'2h'`.
- A string with whitespace is a cron expression and must contain exactly five whitespace-separated fields.

Durations may also be raw millisecond numbers in the object form.

## Per-job options

Use an object when a job needs options beyond its schedule:

```typescript
scheduler({
  'content.fetch': {
    interval: '5m',
    jitter: '30s',
    retry: {
      forever: true,
      backoff: { initial: '10s', max: '2m', factor: 2 },
    },
    command: { type: 'content.fetch' },
    runOnStart: false,
    enabled: true,
  },
});
```

### `interval`

- **Type:** `string | number`
- **Default:** none; required when `cron` is absent

A duration between interval runs. The next interval is computed when the previous dispatch completes, so interval jobs cannot overlap themselves.

### `cron`

- **Type:** `string`
- **Default:** none; required when `interval` is absent

A five-field cron expression. Cron schedules stay anchored to wall-clock occurrences. The next occurrence is armed before the current dispatch completes; a command already in progress is skipped rather than queued.

Exactly one of `interval` and `cron` is required.

### `jitter`

- **Type:** `boolean | string | number`
- **Default:** `true`

Adds a fresh, positive random delay to every scheduled run and retry, spreading a fleet of kiosks out so they don't all fire at once.

The `true` default resolves differently by schedule type:

- **Interval jobs** (and retry backoff): up to 10% of the delay being scheduled.
- **Cron jobs:** up to 60 seconds. A cron gap can be many hours, so a percentage of it would drag the run far off its wall-clock time; the fixed 60-second cap desyncs a fleet without shifting the occurrence meaningfully. For example, a nightly `'0 3 * * *'` job still fires within a minute of 3am.

Supply a duration to set a fixed maximum jitter for either schedule type, or `false` to disable jitter.

### `retry`

- **Type:** `{ forever?: true; backoff?: Backoff } | { forever: false; maxAttempts: number }`
- **Default:** `{ forever: true, backoff: { initial: 15000, max: 300000, factor: 2 } }`

Failed dispatches retry before the normal schedule resumes. By default, retries continue forever with exponential backoff: 15 seconds initially, doubled each attempt, and capped at five minutes. A successful dispatch resets the failure count and backoff.

To stop after a fixed number of failed attempts, opt out of the default policy:

```typescript
scheduler({
  'content.fetch': {
    interval: '5m',
    retry: { forever: false, maxAttempts: 3 },
  },
});
```

`maxAttempts` must be a positive integer. Limited-retry jobs use the default backoff curve and cannot customize it.

A command rejected because it is already running is an overlap skip, not a failure. It does not consume an attempt or begin backoff.

#### `backoff`

- **Type:** `{ initial?: string | number; max?: string | number; factor?: number }`
- **Default:** `{ initial: 15000, max: 300000, factor: 2 }`

Available only with the default `forever: true` retry policy. `initial` and `max` are durations; `factor` must be positive. Omitted fields retain their defaults.

### `command`

- **Type:** command object with a string `type`
- **Default:** `{ type: <record key> }`

Overrides the command dispatched for this job. This is useful when the command needs a payload.

```typescript
scheduler({
  'content.fetch': {
    interval: '5m',
    command: { type: 'content.fetch', force: true },
  },
});
```

### `runOnStart`

- **Type:** `boolean`
- **Default:** `false`

Dispatches the job immediately when the scheduler starts. When `false`, the first dispatch occurs after the scheduled delay.

### `enabled`

- **Type:** `boolean`
- **Default:** `true`

When `false`, the job is never scheduled or dispatched and does not appear in the Scheduler status section. A disabled job is invisible to the runtime commands too: `scheduler.pause`, `scheduler.resume`, and `scheduler.trigger` treat its id as unknown, and a broadcast `scheduler.pause`/`scheduler.resume` (no `job` given) skips it entirely.

## Limitations

Schedules and retry state are in memory only. On restart, each job receives a fresh schedule from the current time, and cron occurrences missed while Launchpad was stopped are skipped.
