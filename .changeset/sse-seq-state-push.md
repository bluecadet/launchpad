---
"@bluecadet/launchpad-controller": minor
---

Every SSE frame the HTTP transport broadcasts now carries a monotonic `id:` sequence number, and the transport can push state-store changes as `launchpad:state:patch` and `launchpad:status:snapshot` frames.

The sequence counter is per-transport and shared by all connected clients: a client baselines on the first `id:` it sees and treats any value other than `previous + 1` — a daemon restart resets the counter — as its signal to re-query the authoritative source. There is no ring buffer and `Last-Event-ID` is not honored on reconnect; push remains best-effort sugar over an authoritative query. The `retry:` line, `: ping` keep-alives, and replay-backlog frames carry no `id:` and never advance a client's baseline. An event the `events` filter drops consumes no sequence number.

Two new options, both off by default: `pushStatePatches` emits Immer state patches with the state store's `_version` (mirroring what the IPC transport has always pushed), so a client can mirror state locally and refetch on a `_version` gap; `pushStatusSnapshots` emits the display-oriented status snapshot on every state change. `pushStatePatches` requires `exposeState`, since `GET /state` is the only recovery path from a detected gap. Pushed state is a JSON projection: `Date` becomes an ISO string and `Map`/`Set` become placeholders, matching what `GET /state` already serves.

The `launchpad:` prefix is now reserved for transport-generated frames; bus events under that prefix are never forwarded to SSE clients.
