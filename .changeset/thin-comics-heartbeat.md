---
"@bluecadet/launchpad-content": minor
---

Add the `content.ack` command: IPC sugar that writes/renews `<downloadPath>/acks/<consumerId>.json` with `{ versionId }`, the same lease file an app could write itself. Both `consumerId` and `versionId` are required -- there's no acking "whatever is current" -- and `consumerId` is sanitized against path traversal. Errors cleanly with `versioning` off, since the acks directory concept doesn't exist otherwise.
