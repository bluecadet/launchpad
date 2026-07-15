---
"@bluecadet/launchpad-scheduler": patch
---

Fix `jitter: true` (the default) shifting cron jobs by hours. It resolved to 10% of the gap to the next occurrence, so a nightly `'0 3 * * *'` job could fire up to ~2.4h late. Cron schedules now cap `true` jitter at a fixed 60 seconds — enough to desync a fleet without moving the wall-clock fire. Interval jobs, explicit durations, and `false` are unchanged.
