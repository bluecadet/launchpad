---
"@bluecadet/launchpad": major
"@bluecadet/launchpad-scaffold": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-cli": major
---

**New CLI Package**:
- Move CLI to separate package
- Lazy import CLI commands to improve startup time
- Move config and dotenv loading and parsing to CLI package
- convert core package to have no code, just a shorthand for installing all sub-packages