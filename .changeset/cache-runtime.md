---
"@bluecadet/launchpad-cli": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-controller": major
"@bluecadet/create-launchpad": major
"@bluecadet/launchpad": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-observability": major
"@bluecadet/launchpad-scheduler": major
"@bluecadet/launchpad-utils": major
---

Require Node.js 24.x or 26 and later (`^24 || >=26`) across the runtime packages and scaffolder. Node.js 23 and 25 are no longer supported. The content artifact cache uses built-in `node:sqlite`; this changes the published runtime baseline, not just the repository development requirement.

Generated projects declare the supported Node range. Updates add it when missing and preserve an explicit existing declaration. Check that your project's range matches the supported runtime.

Expose the shared operating-system file lease through `@bluecadet/launchpad-utils/native-file-lease` so controller and content writers use the same ownership primitive.
