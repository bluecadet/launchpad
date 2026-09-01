---
"@bluecadet/launchpad-cli": patch
"@bluecadet/launchpad-docs": patch
---

`launchpad status` no longer crashes with an uncaught `TypeError` against a daemon started before node identity shipped. The Node line now shows an actionable hint to restart the daemon (`launchpad stop` then `launchpad start`) instead of throwing while formatting the missing identity.
