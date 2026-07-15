---
"@bluecadet/launchpad-scheduler": minor
---

Add `scheduler.pause`, `scheduler.resume`, and `scheduler.trigger` runtime commands, dispatched through the controller like any other command. `pause`/`resume` take an optional `job` to scope to one job (omit for all); `trigger` fires a job immediately, errors if it's already running, and revives an exhausted job (a paused job still fires once but stays paused).
