---
"@bluecadet/launchpad-cli": major
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
---

Plugins can now declare CLI commands via `manifest.cli`. The hardcoded `content` and `monitor` CLI commands are removed — both plugins now declare their commands via their manifests. See the `@bluecadet/launchpad` changelog for migration details.
