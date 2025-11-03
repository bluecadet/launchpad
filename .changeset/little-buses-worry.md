---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad": major
"@bluecadet/launchpad-scaffold": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-cli": major
---

Remove barrel files. All packages no longer have an index export file that re-exports the public APIs. Instead, those APIs are accessible directly. This updates nearly all import paths across the entire launchpad ecosystem.
