---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-cli": patch
"@bluecadet/create-launchpad": patch
---

Add `httpTransport`, an HTTP/SSE push transport for non-Node consumers like browsers and Unity. It streams bus events over `GET /events`, dispatches allowlisted commands via `POST /command`, and serves display-oriented status over `GET /status` (plus an opt-in `GET /state`). It's best-effort sugar alongside the existing IPC transport — the `manifest.json` poll contract remains authoritative.

`GET /events` replays a catch-up backlog to newly-connected clients: for each event name listed in the new `replayEvents` option (default `["content:version:promoted"]`), the transport remembers that event's last emitted frame and replays it, in last-emission order, before streaming live. Replayed events must also pass the `events` filter; everything else streams live only.

Add a `ready()` plugin lifecycle phase (`Readyable` in `@bluecadet/launchpad-utils/plugin-interfaces`): after all plugins finish `setup()`, the controller calls `ready()` on each one, in registration order. A `ready()` that fails or throws is logged and contained. Plugins registered later get their `ready()` right away. `@bluecadet/launchpad-cli` calls `controller.ready()` in both its `start` and plugin-command paths.

`@bluecadet/launchpad-content` uses `ready()` to re-emit `content:version:promoted` when a version is already active on disk at startup, so anything listening (including a freshly-connected `httpTransport` client) learns the active version without waiting for the next fetch.

`ControllerMode` moves from `@bluecadet/launchpad-controller` to `@bluecadet/launchpad-utils`, re-exported from `@bluecadet/launchpad-controller/config` — no consumer changes needed.

The `create` scaffold now hints at `httpTransport()` in generated Launchpad configs.
