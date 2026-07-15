---
"@bluecadet/launchpad-utils": patch
---

Fix `PatchedStateManager.updateState` letting a throwing patch subscriber unwind into the code that produced the state update and skip the remaining subscribers. Handlers are now invoked with the same catch-and-log isolation as `EventBus` handlers.
