---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-cli": minor
"@bluecadet/launchpad-content": patch
"@bluecadet/launchpad-monitor": patch
"@bluecadet/launchpad-utils": patch
---

Adds persistent controller mode with a JSON-RPC 2.0 IPC interface.

### `launchpad start`

A new `start` command launches the controller in persistent mode, opening an IPC socket so subsequent CLI commands connect to the running instance:

```bash
launchpad start         # foreground
launchpad start -d      # background (detached)
```

### IPC

The CLI communicates with a running controller over a JSON-RPC 2.0 socket. The `IPCClient` API (`queryState()`, `executeCommand()`, `shutdown()`, event subscriptions) is the programmatic interface for this. A CLI and daemon must be on the same version.

### `LaunchpadConfig` moved to utils

`LaunchpadConfig` moves from `@bluecadet/launchpad-cli` to `@bluecadet/launchpad-utils`, enabling declaration merging without a direct dependency on the CLI package.
