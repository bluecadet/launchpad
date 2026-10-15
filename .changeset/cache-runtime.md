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

Run Launchpad and the scaffolder on Node.js 24.x or 26 and later (`^24 || >=26`), now required for the content cache's built-in `node:sqlite`. Check your project's Node range: generated projects declare it, but updates preserve existing declarations.

The shared file lease is also exported at `@bluecadet/launchpad-utils/native-file-lease`.
