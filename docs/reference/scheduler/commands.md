---
title: "Scheduler commands & events"
---
The scheduler registers commands that control configured jobs. Dispatch them through the controller, the CLI, or an IPC client.

## `scheduler.pause`

```typescript
{ type: 'scheduler.pause', job?: 'content.fetch' }
```

Pauses a named job, or every job when `job` is omitted. A pause cancels the pending interval, cron, or retry timer; a dispatch already in flight still finishes.

Pausing during backoff cancels the retry. Resuming discards the previous attempt count and backoff state and starts a new schedule from the resume time.

## `scheduler.resume`

```typescript
{ type: 'scheduler.resume', job?: 'content.fetch' }
```

Resumes a named job from the current time, or every job when `job` is omitted. Resume clears retry state and revives a job that stopped after reaching `maxAttempts`.

## `scheduler.trigger`

```typescript
{ type: 'scheduler.trigger', job: 'content.fetch' }
```

Runs a named job immediately and schedules its next tick from the completion of that dispatch. `job` is required.

Triggering a job while one of its dispatches is running returns an error; triggers are not queued. Trigger revives a job stopped by `maxAttempts` but does not resume a paused job: a paused job runs once and stays paused.

Each command rejects an unknown job id. Job ids must be dotted command ids, such as `content.fetch`. A job configured with `enabled: false` is never constructed, so these commands treat it as unknown: naming it returns an error, and a broadcast `scheduler.pause` or `scheduler.resume` (no `job` given) skips it.

## Overlap behavior

An interval job schedules its next run after the previous dispatch completes, so it never overlaps itself. Cron jobs stay anchored to wall-clock time and can fire while an earlier dispatch is still running. In either case, if the command rejects a dispatch because it is already in progress, the scheduler records an overlap skip instead of a failure and does not retry or back off.

## Hung dispatches (known limitation)

An interval job anchors its next run to the completion of the previous dispatch. If a dispatched command hangs and never resolves or rejects, the interval job never re-arms and stops without an error. The scheduler has no dispatch timeout, because the command's own in-progress guard stays locked until its promise settles; a timeout could not free the command to run again.

The [status](#status-section) row shows this state as `running · started <age>` and escalates to a warning once the run has been in flight for more than ten intervals. A run age that keeps climbing indicates a hung dispatch.

A cron job keeps firing on schedule, but each occurrence lands while the hung dispatch still holds the command guard and is recorded as an overlap skip. A cron job with a hung dispatch skips forever instead of going silent.

## Events

The scheduler defines no events of its own. It watches command dispatch results internally to schedule retries and to maintain status state.

## Status section

`launchpad status` shows a **Scheduler** section when at least one configured job is enabled, with one row per enabled job:

| Job state | Status row |
| --- | --- |
| Before the first run | `every 5m · first run in 5m` |
| Last run succeeded | `every 5m · last ok 5m ago · next in 4m` |
| Last run skipped because the command was busy | `every 5m · last run skipped (command busy) · next in 4m` |
| A dispatch is currently in flight | `every 5m · running · started 3m ago` |
| Retrying after a failure | `retrying (attempt 2) · next retry in 30s · last error: ...` |
| Gave up after `maxAttempts` | `gave up after 3 attempts · last error: ...` |
| Paused | `paused` |

Healthy, first-run, overlap-skip, and running rows show as OK; retrying rows are warnings; exhausted jobs are errors; paused jobs are neutral. A running row becomes a warning once the run has been in flight for more than ten intervals (see [Hung dispatches](#hung-dispatches-known-limitation)). Disabled jobs have no row. Cron rows show the next clock time and its relative time, for example `next 12:05 (in 4m)`.
