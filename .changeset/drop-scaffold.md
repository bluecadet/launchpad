---
"@bluecadet/launchpad": major
"@bluecadet/launchpad-cli": major
---

Remove the `scaffold` package and `launchpad scaffold` CLI command. Windows kiosk and exhibit machine configuration is now handled by [Preflight](https://github.com/bluecadet/preflight), a dedicated tool by Bluecadet.

**Migration**: If you relied on `launchpad scaffold` or `@bluecadet/launchpad/scaffold`, switch to [Preflight](https://github.com/bluecadet/preflight).
