---
"@bluecadet/launchpad-controller": patch
---

Contain plugin code that throws synchronously or rejects its underlying promise. A plugin `executeCommand` that threw (instead of returning `errAsync`) unwound out of the command dispatcher into `ResultAsync.fromSafePromise` in the workflow runner, crashing the process; a throwing plugin `setup` similarly escaped `registerPlugin`. Both are now converted to err Results at the plugin boundary, so a faulty plugin fails its command or registration without taking launchpad down.
