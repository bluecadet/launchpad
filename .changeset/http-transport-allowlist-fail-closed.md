---
"@bluecadet/launchpad-controller": major
"@bluecadet/create-launchpad": patch
"@bluecadet/launchpad-docs": patch
---

`httpTransport`'s `allowedCommands` now defaults to `[]` instead of `["content.ack", "content.manifest.read"]`.

The old default assumed every Node runs the content plugin, which is optional. Controller core only ever registered `workflow.run` and `workflow.list` itself; `content.ack` and `content.manifest.read` are registered by `content(...)`. A Node configured without the content plugin still shipped a default that named those two commands, so a `POST /command` against either one passed the allowlist gate and any role check, then failed at dispatch with a `500 CommandExecutionError: Command '...' is not registered` — a guaranteed server error reachable from the out-of-the-box config.

**Breaking:** a deployment that relied on the default to reach `content.ack` or `content.manifest.read` must now list them in `allowedCommands` explicitly. With no `allowedCommands` configured, `POST /command` now rejects every command with `403` instead of allowing two specific ones through to a gate they may or may not clear.
