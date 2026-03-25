---
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-controller": patch
"@bluecadet/launchpad-content": patch
"@bluecadet/launchpad-monitor": patch
---

Centralizes plugin state management in the controller. Plugins now call `ctx.updateState()` to establish and update their state slice instead of implementing `StateProvider`. The controller lazily creates a scoped state store per plugin on first `updateState` call, handling patch generation, versioning, and broadcasting. Renames `ctx.getState` → `ctx.getGlobalState` and `ctx.onStatePatch` → `ctx.onGlobalStatePatch`.
