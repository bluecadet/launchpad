---
"@bluecadet/launchpad-dashboard": major
"@bluecadet/launchpad": major
"@bluecadet/launchpad-scaffold": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
---


- Add basic support for Plugin API across `content`, `monitor`, and `core` packages.
- Implement full support for plugins in `content` package.
- Refactor `content` sources to be functions.
- Refactor `content` transforms and media-downloader to be plugins.
- Implement `neverthrow` for error handling in `content` package.
- Add unit tests for `content` package.
- Fully remove credentials API (superseded by dotenv config)