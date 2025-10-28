---
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-cli": minor
---

Refactor monitor and content state to use Immer. This allows us to emit patch events when state changes, which are then handled by the controller package to sync state across processes (just IPC for now).

Adds a new "watch" flag to the CLI status command to allow live monitoring of the controller status.
