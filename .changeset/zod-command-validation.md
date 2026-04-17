---
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
---

Add Zod runtime validation for plugin commands.

Content and monitor plugins now validate incoming commands against Zod schemas before processing. Invalid commands are rejected with a typed error at the plugin boundary rather than failing deep in business logic.

`ContentCommandSchema` and `MonitorCommandSchema` are exported from their respective packages for use in custom integrations.
