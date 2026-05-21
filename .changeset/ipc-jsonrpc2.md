---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-cli": patch
---

Migrate IPC transport wire format to JSON-RPC 2.0.

The IPC protocol between the CLI and persistent controller now uses JSON-RPC 2.0 message shapes (`jsonrpc`, `method`, `params`, `result`, `error` fields) instead of the previous proprietary `type`/`data` format. The devalue serialization layer and newline-delimited framing are unchanged.

This is an internal protocol change. The public `IPCClient` API (`queryState()`, `executeCommand()`, `shutdown()`, event subscriptions) is unchanged. A CLI and daemon must be on the same version — old CLIs cannot communicate with new daemons, and vice versa.
