---
"@bluecadet/launchpad-scheduler": minor
---

Add retry loop with backoff on command failure. A real dispatch failure now retries on its own capped-exponential schedule (15s → ×2 → 5m by default) instead of waiting for the job's normal cadence, resetting fully on any success. Opt-in `retry: { forever: false, maxAttempts }` stops the job once exhausted. Overlap skips (`CommandInProgressError`) remain fully exempt from retry bookkeeping.
