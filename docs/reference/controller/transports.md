---
title: "Transports"
---
A transport is an ordinary controller plugin that exposes the command bus and event bus over some wire protocol. Launchpad ships two:

- **IPC transport** — a Unix socket (named pipe on Windows), gated by filesystem permissions. Used by the CLI to talk to a running `launchpad start` daemon. Not token-authenticated — see [Security posture](./security.md).
- **HTTP/SSE transport** (`httpTransport`) — a small HTTP surface on loopback, for consumers that can't open a Unix socket: browsers and Unity/.NET clients.

This page covers the HTTP/SSE transport.

## Adding the transport

`httpTransport` is a plugin like any other; add it to the `plugins` array alongside the plugins whose commands and events you want to expose:

```typescript
import { content } from "@bluecadet/launchpad/content";
import { httpTransport } from "@bluecadet/launchpad/controller/transports/http";

export default defineConfig({
  plugins: [content({ versioning: true }), httpTransport({ port: 8710 })],
});
```

> [!NOTE]
> Push over `/events` is best-effort sugar on top of the [version manifest](../content/version-manifest.md) poll contract. Applications must keep polling `<downloadPath>/manifest.json` — the HTTP transport is a lower-latency notification, not a replacement.

In task mode (one-shot CLI invocations) the plugin is inert and never binds a port. Options are still validated in task mode, so a malformed config (e.g. an out-of-range `port`) fails setup even though nothing is bound.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `8710` | Port to listen on. `0` picks a random free port (useful in tests). |
| `host` | `string` | `"127.0.0.1"` | Host/interface to bind. |
| `allowedCommands` | `string[]` | `["content.ack", "content.manifest.read"]` | Command types accepted by `POST /command`. Anything else is rejected with `403`. Entries are prefix globs, matched like `events`. |
| `events` | `string[]` | `["content:*"]` | Event names forwarded to SSE clients. An entry ending in `*` prefix-matches everything before it; the single entry `*` matches all events; any other entry is an exact match. |
| `replayEvents` | `string[]` | `["content:version:promoted"]` | Event names eligible for replay-on-connect. For each listed name, the transport remembers that event's last emitted frame and replays it to newly-connected clients; an event must also pass the `events` filter to be replayed. |
| `keepAliveMs` | `number` | `15000` | Interval between `: ping` SSE comment lines, keeping idle connections (and intermediate proxies) alive. |
| `maxClients` | `number` | `32` | Maximum concurrent SSE clients. Further `GET /events` requests get `503` once this is reached. |
| `exposeState` | `boolean` | `false` | Expose the full global state at `GET /state`. Off by default — see [Security model](#security-model). |
| `pushStatePatches` | `boolean` | `false` | Push state-store patches as `launchpad:state:patch` frames. Requires `exposeState` — setup fails without it. See [State push](#state-push). |
| `pushStatusSnapshots` | `boolean` | `false` | Push the status snapshot as a `launchpad:status:snapshot` frame on every state change. Off by default: building one runs every plugin's `summarize()`. |
| `auth` | `{ tokens, roles }` | `{}` | Named tokens and their command allowlists. Empty leaves the transport unauthenticated. See [Security posture](./security.md#configuring-tokens). |
| `allowedOrigins` | `string[]` | `["*"]` | Origins allowed to read responses cross-origin. Any list other than `["*"]` echoes a matching `Origin` and omits the header otherwise. |
| `allowUnauthenticated` | `boolean` | `false` | Permit binding a non-loopback `host` with no tokens configured. Off by default: that combination is a setup error. |

## Endpoints

Responses carry the CORS headers `allowedOrigins` implies — by default `Access-Control-Allow-Origin: *`.

When `auth.tokens` is configured, **every** route requires a token: `/status`, `/state`, `/events`, `/command`, and unknown paths all answer `401` without one. Preflights are the exception. Present a token as `Authorization: Bearer <token>` anywhere, or as `?access_token=<token>` on `GET /events` only. See [Security posture](./security.md) for the full model.

### `GET /events`

Opens a Server-Sent Events stream. On connect, the transport writes:

1. A `retry: 2000` line, telling `EventSource` to wait 2 seconds before reconnecting after a drop.
2. The replay backlog (see below) — un-sequenced.

After that, every bus event matching the `events` option is forwarded as an SSE frame carrying an `id:` [sequence number](#sequence-numbers-and-gap-detection), and a `: ping` comment line is written every `keepAliveMs`. With `pushStatePatches` or `pushStatusSnapshots` on, [state frames](#state-push) are interleaved into the same stream and share the same counter.

If `maxClients` concurrent streams are already open, the request gets `503` instead of a stream.

Browser `EventSource` cannot set request headers, so this route — and only this route — also accepts the token as a `?access_token=` query parameter:

```javascript
new EventSource(`http://127.0.0.1:8710/events?access_token=${token}`);
```

Every authenticated client receives every frame that passes the `events` filter. The stream is not scoped by token role.

#### Replay on connect

A client that connects between two emissions would otherwise learn nothing until the next one. To close that gap, the transport remembers the **last frame of each event name listed in `replayEvents`** and replays those frames — in the order each event was last emitted — to every newly connected client, before live streaming begins. Events not in `replayEvents` stream live only; they're never replayed, no matter how the `events` filter is configured.

Consequences worth knowing:

- Only `replayEvents` names are remembered. By default that's just `content:version:promoted`; other events (e.g. `content:fetch:start`) still pass through `GET /events` live if `events` allows them, but connecting late means missing them.
- One frame per listed event name. A second emission replaces the remembered frame; clients never receive a backlog of two frames for one event.
- To be remembered, an event must also pass the `events` filter — listing a name in `replayEvents` doesn't override `events`.
- The backlog lives in memory and starts empty. A client connecting to a controller that hasn't emitted a replayable event yet gets only the `retry:` line for that event.

In practice this is what makes a fresh browser or Unity client learn the active content version without waiting for the next fetch: the content plugin announces the active version on disk during the `ready()` phase, shortly after the port opens during `setup()`. A client that connects in that narrow window receives the announcement live rather than from the backlog; one that connects afterward gets it replayed.

```
id: 41
event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

```

### Sequence numbers and gap detection

Every frame the transport broadcasts carries a monotonic `id:` — the native SSE field, surfaced to browsers as `MessageEvent.lastEventId`. The rules:

- **One counter per transport, shared by all clients.** Two clients connected at the same moment see the same `id` on the same frame. Your first `id` is whatever the transport is up to, so **baseline on the first `id` you receive** — never assume it starts at 1.
- **The counter covers every broadcast frame, not just the ones you listen for.** With the default `events: ["content:*"]`, one fetch emits a dozen frames and a client that only handles `content:version:promoted` sees the id jump by that much — a gap on every promote. To use the id at all, either handle every forwarded name (including the `launchpad:` frames when [state push](#state-push) is on) or narrow `events` to what the client consumes.
- **Replay-backlog frames carry no `id:`, and a browser can't tell.** `EventSource` remembers the last id it received and reports it on every event after that, un-sequenced ones included, so a replayed frame following a reconnect arrives carrying the id of the last live frame from before the drop. Don't try to spot the backlog — treat every reconnect as a gap instead. (`retry:` and `: ping` never reach a handler at all: one is a directive, the other an SSE comment.)
- **A gap is your signal to re-query, not to ask for a replay.** Any `id` other than `previous + 1` — higher *or lower*, since a daemon restart resets the counter to zero — means you may have missed something. Re-read the authoritative source: `GET /status`, `GET /state`, or the relevant command.
- **There is no ring buffer, and `Last-Event-ID` is ignored.** `EventSource` sends that header on reconnect and the transport does not act on it. Reconnect does not resume; it starts a fresh baseline. Nothing is retained for redelivery — push is best-effort sugar over an authoritative query.
- **Only broadcast frames consume a number.** An event the `events` filter dropped, and any frame produced while no client is connected, burns nothing. The counter is gap-free from every connected client's point of view.

```javascript
// Sound only if this client handles every name the transport forwards.
let lastSeq;

function checkSeq(event) {
  const seq = Number(event.lastEventId);
  const contiguous = lastSeq === undefined || seq === lastSeq + 1;
  lastSeq = seq;
  return contiguous;
}

// A drop is a gap the ids can't show — the counter kept running while you were
// away. Rebaseline and re-read the authoritative source on every reconnect.
eventSource.addEventListener("open", () => {
  if (lastSeq === undefined) return; // first connect: nothing to resync
  lastSeq = undefined;
  refetchAuthoritativeState();
});
```

The first frame after a reconnect is usually a replayed one carrying a stale id, so the frame after *that* may look like one more gap. Re-reading is idempotent; a spurious re-read costs a request.

### State push

With `pushStatePatches: true`, every change to the controller's state store is pushed as a `launchpad:state:patch` frame — the same payload the IPC transport has always sent, on the same schedule:

```
id: 42
event: launchpad:state:patch
data: {"patches":[{"op":"replace","path":["plugins","content","activeVersion"],"value":"20260714T153045Z"}],"version":18}

id: 43
event: launchpad:status:snapshot
data: {"header":{"startTime":"2026-07-14T15:30:47.112Z","uptimeMs":8100000,"mode":"persistent","node":{"id":"gallery-kiosk-1","label":"Gallery Kiosk 1"}},"sections":[]}

```

| SSE frame | IPC method | Payload |
| --- | --- | --- |
| `launchpad:state:patch` | `statePatch` | `{ patches, version }` |
| `launchpad:status:snapshot` | `statusSnapshot` | The `GET /status` snapshot |

- `patches` are [Immer](https://immerjs.github.io/immer/) patches, path-prefixed `["plugins", <pluginName>, …]`, so they apply directly to a mirror of `GET /state` with `applyPatches`.
- `version` is the state store's `_version`, the same counter `GET /state` returns. **If `version` is not `previous + 1`, your mirror is stale: refetch `GET /state` and rebaseline.** That is why `pushStatePatches` requires `exposeState` — without `GET /state` there is no way back from a gap, so the combination is rejected at setup.
- With both options on, the patch frame is always written before the snapshot frame, on consecutive `id`s.
- Patches only ever originate from plugin state slices. System state (including `system.startTime`) never appears in one, so a patch stream and a `GET /state` refetch stay consistent with each other.

> [!WARNING]
> Enabling `pushStatePatches` broadcasts **every plugin's entire state slice** to every authenticated SSE client. Events and state are transport-global: there is no per-client scoping and no filtering by token role. If a client shouldn't see something, don't put it in state.

Pushed state is a JSON projection, not the TypeScript type. See [Limitations](#limitations).

### Reserved frame names

The `launchpad:` prefix belongs to the transport. A bus event whose name starts with it is never forwarded to SSE clients, even under `events: ["*"]`, and the transport logs a warning instead. This keeps a plugin from emitting a bus event that lands on clients looking like a state frame.

### `POST /command`

Dispatches a command from `allowedCommands`. Body is JSON with at least a `type` field, capped at 64KB.

| Status | When |
| --- | --- |
| `200` | Command dispatched; body is `{ result }`. |
| `400` | Body isn't valid JSON, or has no string `type` field, or the request body couldn't be read. |
| `401` | `auth.tokens` is configured and no valid token was presented. |
| `403` | `type` isn't in `allowedCommands` — applies to every caller. |
| `403` | The token is valid, but its role's globs don't cover `type`. The message names the role. |
| `413` | Body exceeds the 64KB limit. |
| `500` | The command dispatched but returned an error; body is `{ error: { name, message, cause? } }`, with `cause` recursing through the error chain. |

```bash
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LAUNCHPAD_TOKEN_DOCENT" \
  -d '{"type":"content.manifest.read"}'
```

### `GET /status`

Returns the same display-oriented status snapshot as `launchpad status`, as JSON. The `header` block identifies the Node that produced it:

```json
{
  "header": {
    "startTime": "2026-07-14T15:30:47.112Z",
    "uptimeMs": 8100000,
    "mode": "persistent",
    "node": { "id": "gallery-kiosk-1", "label": "Gallery Kiosk 1", "role": "exhibit" }
  },
  "sections": []
}
```

`header.node.label` always has a value — unconfigured, it mirrors `id`. `header.node.role` is absent rather than `null` when no Node role is set. See [Controller Config](./controller-config.md#node) for how the identity is configured and defaulted.

**Liveness.** With tokens configured, `GET /status` needs one like every other route — and any valid token can read it. `GET /status` is the remote liveness check — the remote analogue of the pid-file check the CLI does locally. One round trip answers both "is this Node up?" and "which Node is it?", so a client fanning out across a network identifies each response by `header.node.id`. There is no separate unauthenticated liveness endpoint: a second route would be one more thing to carve out of the auth gate, for no information the snapshot doesn't already carry.

Two things worth knowing before pointing a probe at it:

- Building the snapshot runs every plugin's `summarize()`. Polling a handful of Nodes at 1 Hz is trivial; a 10 Hz probe is not free.
- The snapshot is a display projection, not a health verdict. It reports what each plugin says about itself; deciding what counts as unhealthy is the client's job.

### `GET /state`

Returns the full global controller state as JSON. Returns `404` unless `exposeState: true` — see [Security model](#security-model).

### `OPTIONS *`

Answers any path with a `204` CORS preflight response (`GET, POST, OPTIONS`, `Authorization` and `Content-Type` headers allowed, cached 24h). Preflights are never authenticated: browsers don't attach `Authorization` to them, so a `401` here would break every browser client before the real request was made.

### Anything else

`404`, with `{ error: { message } }` naming the method and path.

## SSE wire format

```
retry: 2000

event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

id: 12
event: content:version:promoted
data: {"versionId":"20260715T091203Z","versionPath":"versions/20260715T091203Z","generatedAt":"2026-07-15T09:12:05.004Z"}

id: 13
event: launchpad:state:patch
data: {"patches":[{"op":"replace","path":["plugins","content","activeVersion"],"value":"20260715T091203Z"}],"version":19}

: ping

```

The second frame here is the replay backlog — same event, no `id:`. Live frames follow with one.

Multi-line data is framed with one `data:` field per line, so a payload with embedded newlines survives `EventSource` reassembly.

## Security model

Loopback HTTP is not equivalent to the IPC transport's Unix socket. A Unix socket's reachability is gated by filesystem permissions on the socket path. A loopback TCP port is reachable by **any process on the machine**, and — because browsers allow `no-cors` cross-origin requests to complete even though the response body is opaque to the page — by drive-by JavaScript running in any tab the user has open, regardless of CORS headers. `POST /command` in particular can be triggered blind from a malicious page.

This is why the transport is deliberately conservative:

- **Tokens.** With `auth.tokens` configured, every route needs one, and each token's role narrows which commands it can dispatch. Binding a non-loopback `host` without tokens is a setup error.
- **Command allowlist.** Only `allowedCommands` can be dispatched; everything else is `403`. There is no way to widen this from the wire — only from config.
- **No shutdown route.** Unlike the IPC transport, there is no way to stop the controller over HTTP.
- **`/state` is opt-in.** Full global state can contain more than a browser page should be able to read passively; it is `404` unless `exposeState: true`.
- **State push inherits that decision.** `pushStatePatches` requires `exposeState` and is off by default. Enabling it puts every plugin's state slice on the wire to every authenticated client, whatever its token role.

[Security posture](./security.md) covers the whole model: configuring tokens, role globs and how they intersect with `allowedCommands`, the `401`/`403` split, CORS, and the limitations you're accepting.

## Limitations

- **Task mode is a no-op.** One-shot CLI runs never bind a port; the transport only runs alongside a persistent controller.
- **JSON serialization is lossy.** Event payloads, command results, and pushed state are serialized with `JSON.stringify`-equivalent semantics, not the [`devalue`](https://github.com/Rich-Harris/devalue) codec the IPC transport uses. Cycles, `Map`/`Set`, `undefined`, and other non-JSON values won't round-trip. Everything HTTP serves is that projection: `Date` becomes an ISO string, `Map`/`Set`/functions/symbols/cycles become `[unserializable: …]` placeholders. `GET /state` and `launchpad:state:patch` are projected identically, so a mirror built from one stays consistent with the other — but neither matches the plugin's TypeScript type exactly. Several shipped plugin slices already store `Date`s; treat pushed state as JSON, and keep new slices JSON-native. The transport warns once when a pushed patch degrades to a placeholder; a `Date` produces no placeholder and so cannot be detected.
- **Slow SSE clients may drop events.** Writes are fire-and-forget with no backpressure handling; a client that can't keep up may silently miss events. The manifest poll fallback covers this by design — see [Version Manifest](../content/version-manifest.md).
- **A failed port bind is a hard setup failure.** `EADDRINUSE` and similar bind errors fail plugin setup with no auto-recovery.
- **Events are transport-global.** Every authenticated SSE client receives every event passing the `events` filter, regardless of its token role. Keep role-sensitive data out of event payloads.
- **`Last-Event-ID` is not honored.** Reconnecting clients start a fresh sequence baseline; there is no replay of missed frames beyond `replayEvents`.
- **Status snapshots are expensive.** Building one runs every plugin's `summarize()`, and a content fetch produces many patch batches. Leave `pushStatusSnapshots` off unless a client actually needs it; there is no throttling or coalescing.
- **No TLS.** Traffic is plaintext HTTP, tokens included. See [Security posture](./security.md#the-v1-posture-trusted-vlan-plus-tokens).
