---
title: "Scheduler Commands & Events"
---

# Scheduler Commands & Events

The scheduler registers three commands for controlling configured jobs. Dispatch them through the controller, CLI, or an IPC client as appropriate for your application.

## `scheduler.pause`

```typescript
{ type: 'scheduler.pause', job?: 'content.fetch' }
```

Pauses a named job. Omit `job` to pause every job. A pause cancels the pending interval, cron, or retry timer, but a dispatch already in flight is allowed to finish.

Pausing during backoff cancels that retry. When the job is resumed, its previous attempt count and backoff state are discarded; the job starts a new schedule from the time it resumes.

## `scheduler.resume`

```typescript
{ type: 'scheduler.resume', job?: 'content.fetch' }
```

Resumes a named job from the current time. Omit `job` to resume every job. Resume clears retry state and also revives a job that stopped after reaching its configured `maxAttempts`.

## `scheduler.trigger`

```typescript
{ type: 'scheduler.trigger', job: 'content.fetch' }
```

Runs a named job immediately and schedules its next tick from the triggered dispatch's completion. The `job` field is required.

Triggering a job while one of its dispatches is running returns an error; triggers are not queued. Trigger can revive a job stopped by `maxAttempts`, but it does not resume a paused job: a paused job runs once when triggered and remains paused afterward.

All three commands reject an unknown job id. Job ids must be dotted command ids, such as `content.fetch`. A job configured with `enabled: false` is never constructed, so it is unknown to these commands too: naming it explicitly errors, and a broadcast `scheduler.pause`/`scheduler.resume` (no `job` given) simply doesn't see it.

## Overlap behavior

An interval job schedules its next run after its previous dispatch completes, so it does not overlap itself. Cron jobs remain wall-clock anchored and can fire while an earlier dispatch is still running. In either case, if the downstream command rejects a dispatch because that command is already in progress, the scheduler records an overlap skip rather than a failure. It does not retry or back off the skipped run.

## Hung dispatches (known limitation)

An interval job anchors its next run to the completion of the previous dispatch. If a dispatched command never settles — it hangs rather than resolving or rejecting — that completion never arrives, so the interval job never re-arms and effectively stops without an error. There is no scheduler-level dispatch timeout: the command's own in-progress guard stays locked until the real promise settles, so a timeout could not free the command to run again anyway.

The operator signal for this state is the running row (see the status table below): the job renders `running · started <age>`, and once the run has been in flight for more than ten intervals the row escalates to a warning. A run age that keeps climbing is the sign of a wedged dispatch.

A cron job degrades differently. It stays wall-clock anchored and keeps firing new occurrences on schedule, but each one lands while the hung dispatch still holds the command guard, so it is recorded as an overlap skip. A cron job with a hung dispatch therefore skips forever rather than going silent.

## Events

The scheduler does not define scheduler-specific events. It observes command dispatch results internally to schedule retries and maintains state for the status display.

## Status section

`launchpad status` shows a **Scheduler** section when at least one configured job is enabled. It contains one row for each enabled job:

| Job state | Status row |
| --- | --- |
| Before the first run | `every 5m · first run in 5m` |
| Last run succeeded | `every 5m · last ok 5m ago · next in 4m` |
| Last run skipped because the command was busy | `every 5m · last run skipped (command busy) · next in 4m` |
| A dispatch is currently in flight | `every 5m · running · started 3m ago` |
| Retrying after a failure | `retrying (attempt 2) · next retry in 30s · last error: ...` |
| Gave up after `maxAttempts` | `gave up after 3 attempts · last error: ...` |
| Paused | `paused` |

Healthy, first-run, overlap-skip, and running rows are shown as OK; retrying rows are warnings; exhausted jobs are errors; and paused jobs are neutral. A running row escalates from OK to a warning once the run has been in flight for more than ten intervals, surfacing a likely wedged dispatch (see [Hung dispatches](#hung-dispatches-known-limitation)). Disabled jobs have no row. Cron rows include both the next clock time and its relative time, for example `next 12:05 (in 4m)`.
