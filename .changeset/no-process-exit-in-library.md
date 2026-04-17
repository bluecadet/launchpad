---
"@bluecadet/launchpad-monitor": patch
"@bluecadet/launchpad-controller": patch
---

Remove `process.exit()` calls from library code.

Library code should never terminate the host process. The monitor and IPC transport now emit a `system:shutdown` event on the event bus instead of calling `process.exit(0)` on graceful shutdown. The CLI handles this event and exits cleanly. Programmatic users of the monitor or controller who relied on the implicit exit should listen for `system:shutdown` instead.
