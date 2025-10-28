---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
"@bluecadet/launchpad-cli": minor
---

Move declaration merging to utils package instead of controller package.

This improves type safety when the controller package is not a dependency, such as when using content/monitor packages in isolation.

The API stays largely the same, with some minor adjustments to import paths and type exports.
