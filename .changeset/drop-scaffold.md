---
"@bluecadet/launchpad": major
"@bluecadet/launchpad-cli": major
---

Remove the `scaffold` package and `launchpad scaffold` CLI command. Windows kiosk and exhibit machine configuration is now handled by [Preflight](https://preflight.bluecadet.com), a dedicated tool by Bluecadet.

**Migration**: If you relied on `launchpad scaffold` or `@bluecadet/launchpad/scaffold`, switch to [Preflight](https://preflight.bluecadet.com).
