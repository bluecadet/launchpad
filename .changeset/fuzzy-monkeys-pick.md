---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-scaffold": minor
"@bluecadet/launchpad-cli": minor
---

Move file logging config and logic to controller, and terminal logging to CLI. Refactor logging to use event bus, so logs are visible across processes.

Also adds a SubsystemContext type to be shared across packages.
