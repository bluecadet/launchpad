---
"@bluecadet/launchpad-monitor": patch
---

Ship precompiled Windows window-management binaries instead of building native dependencies during installation. Windows x64 and cross-compiled arm64 binaries are included; arm64 runtime behavior is not yet verified. Existing window flags, debounce settings, and PM2 behavior are unchanged.
