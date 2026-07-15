# @bluecadet/launchpad-scheduler

## 3.0.0

### Major Changes

- [`386e6e6`](https://github.com/bluecadet/launchpad/commit/386e6e61651e5410494ca99172468175598fc57c) - Initial release of `@bluecadet/launchpad-scheduler`, versioned as 3.0.0 to align with the rest of the Launchpad packages.

### Minor Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Add retry loop with backoff on command failure. A real dispatch failure now retries on its own capped-exponential schedule (15s → ×2 → 5m by default) instead of waiting for the job's normal cadence, resetting fully on any success. Opt-in `retry: { forever: false, maxAttempts }` stops the job once exhausted. Overlap skips (`CommandInProgressError`) remain fully exempt from retry bookkeeping.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Add a Scheduler status section with per-job schedule, outcome, retry, pause, and next-run summaries. Scheduler state snapshots now expose complete job counters and error details for status consumers.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Add `@bluecadet/launchpad-scheduler` package scaffold with a command-keyed config schema (bare duration/cron strings, interval/cron XOR, jitter, retry backoff, `runOnStart`, `enabled`) and a plugin skeleton. No scheduling behavior yet.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Add `scheduler.pause`, `scheduler.resume`, and `scheduler.trigger` runtime commands, dispatched through the controller like any other command. `pause`/`resume` take an optional `job` to scope to one job (omit for all); `trigger` fires a job immediately, errors if it's already running, and revives an exhausted job (a paused job still fires once but stays paused).

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Add scheduling engine: chained-`setTimeout` interval jobs anchored to run completion, wall-clock cron jobs via `croner`, jitter reroll per fire, `runOnStart`, and `CommandInProgressError` overlap skipping. Jobs now actually dispatch on their configured schedule instead of being inert.

### Patch Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Fix `jitter: true` (the default) shifting cron jobs by hours. It resolved to 10% of the gap to the next occurrence, so a nightly `'0 3 * * *'` job could fire up to ~2.4h late. Cron schedules now cap `true` jitter at a fixed 60 seconds — enough to desync a fleet without moving the wall-clock fire. Interval jobs, explicit durations, and `false` are unchanged.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`a3e41db`](https://github.com/bluecadet/launchpad/commit/a3e41db0802cb99d729d3c1065464cecc7d3a60c) - Surface in-flight run age in the Scheduler status section. A job with a dispatch still running now renders `every 5m · running · started 3m ago`, escalating from OK to a warning once the run exceeds ten intervals — the operator signal for a hung dispatch that has wedged an interval job.

- Updated dependencies [[`13cfbe6`](https://github.com/bluecadet/launchpad/commit/13cfbe6ce9bb9efb7a3a3d5d16080538af040acf), [`3665436`](https://github.com/bluecadet/launchpad/commit/3665436402021470f2e9654e81fa978a8fe4daff), [`53fb2fc`](https://github.com/bluecadet/launchpad/commit/53fb2fc74cecd47b33585618a6b39d875d308b02)]:
  - @bluecadet/launchpad-utils@3.1.0
