---
"@bluecadet/launchpad-controller": patch
"@bluecadet/launchpad-cli": patch
"@bluecadet/launchpad": patch
---

Prevent task and persistent controllers from overlapping for the same configured project identity. A kernel-backed lease next to the PID file now provides atomic ownership, while the PID file remains persistent-daemon discovery metadata and the logging-directory lease continues to protect independently configured log storage.
