---
"@bluecadet/launchpad-utils": patch
---

Fix `EventBus.emit` letting a throwing `on()` listener escape into the caller's control flow (e.g. rejecting a neverthrow pipeline mid-flight and crashing the process via an unhandled rejection). Regular listeners are now invoked individually with the same catch-and-log isolation already used for `onAny` wildcard handlers, so one throwing listener no longer stops later listeners from running.
