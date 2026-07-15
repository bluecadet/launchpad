---
"@bluecadet/launchpad-scheduler": patch
---

Surface in-flight run age in the Scheduler status section. A job with a dispatch still running now renders `every 5m · running · started 3m ago`, escalating from OK to a warning once the run exceeds ten intervals — the operator signal for a hung dispatch that has wedged an interval job.
