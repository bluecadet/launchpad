---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-testing": minor
"@bluecadet/create-launchpad": patch
---

Add `httpTransport`, an HTTP/SSE push transport for non-Node consumers like browsers and Unity. It streams bus events over `GET /events`, dispatches allowlisted commands via `POST /command`, and serves display-oriented status over `GET /status` (plus an opt-in `GET /state`). It's best-effort sugar alongside the existing IPC transport — the `manifest.json` poll contract remains authoritative.

`PluginContext` gains `mode` and `getStatusSnapshot`, so transports can serve status snapshots without depending on the controller. `createMockPluginCtx` in the testing package now includes both fields.

The `create` scaffold now hints at `httpTransport()` in generated Launchpad configs.
