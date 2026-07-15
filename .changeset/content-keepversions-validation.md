---
"@bluecadet/launchpad-content": patch
---

Validate `versioning.keepVersions` as a non-negative integer. Fractional or negative values are now rejected at config parse time. `0` remains valid and means retention relies solely on the active-version and fresh-ack backstops.
