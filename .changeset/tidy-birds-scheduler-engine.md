---
"@bluecadet/launchpad-scheduler": minor
---

Add scheduling engine: chained-`setTimeout` interval jobs anchored to run completion, wall-clock cron jobs via `croner`, jitter reroll per fire, `runOnStart`, and `CommandInProgressError` overlap skipping. Jobs now actually dispatch on their configured schedule instead of being inert.
