---
"@bluecadet/launchpad-monitor": patch
---

Fix monitored apps not being stopped when Launchpad exits via SIGINT/SIGTERM. The monitor plugin's `disconnect()` hook now calls `shutdown()` (stop apps + disconnect) instead of only disconnecting from PM2.
