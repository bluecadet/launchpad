---
title: "Transports"
---
A transport is an ordinary controller plugin that exposes the command bus and event bus over some wire protocol. Launchpad ships two:

- **IPC transport** — a Unix socket (named pipe on Windows), gated by filesystem permissions. Used by the CLI to talk to a running `launchpad start` daemon. Not token-authenticated — see [Security posture](./security.md).
- **HTTP/SSE transport** (`httpTransport`) — a small HTTP surface on loopback, for consumers that can't open a Unix socket: browsers and Unity/.NET clients.

This page covers the HTTP/SSE transport.

## Adding the transport

`httpTransport` is a plugin like any other; add it to the `plugins` array alongside the plugins whose commands and events you want to expose. `allowedCommands` defaults to empty, so list the commands the other plugins register or `POST /command` rejects everything:

```typescript
import { content } from "@bluecadet/launchpad/content";
import { httpTransport } from "@bluecadet/launchpad/controller/transports/http";

export default defineConfig({
  plugins: [
    content({ versioning: true }),
    httpTransport({ port: 8710, allowedCommands: ["content.ack", "content.manifest.read"] }),
  ],
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
| `allowedCommands` | `string[]` | `[]` | Command types accepted by `POST /command`. Anything else is rejected with `403`. The default is empty, so `POST /command` rejects everything until you list commands explicitly — there is no set of commands every Node has, since which ones are registered depends on which plugins are configured. Entries are prefix globs, matched like `events`. A docent tablet that triggers Node-local recipes wants `["workflow.run", "workflow.list"]` here; a Node running the [content plugin](../content/index.md) wants `["content.ack", "content.manifest.read"]` for the commands it registers. |
| `events` | `string[]` | `["content:*"]` | Event names forwarded to SSE clients. An entry ending in `*` prefix-matches everything before it; the single entry `*` matches all events; any other entry is an exact match. |
| `replayEvents` | `string[]` | `["content:version:promoted"]` | Event names eligible for [replay on connect](./wire-contract.md#replay-on-connect). For each listed name, the transport remembers that event's last emitted frame and replays it to newly-connected clients; an event must also pass the `events` filter to be replayed. |
| `keepAliveMs` | `number` | `15000` | Interval between `: ping` SSE comment lines, keeping idle connections (and intermediate proxies) alive. |
| `maxClients` | `number` | `32` | Maximum concurrent SSE clients. Further `GET /events` requests get `503` once this is reached. |
| `exposeState` | `boolean` | `false` | Expose the full global state at `GET /state`. Off by default — see [Security model](#security-model). |
| `pushStatePatches` | `boolean` | `false` | Push state-store patches as [`launchpad:state:patch`](./wire-contract.md#launchpadstatepatch) frames. Requires `exposeState` — setup fails without it. |
| `pushStatusSnapshots` | `boolean` | `false` | Push the status snapshot as a `launchpad:status:snapshot` frame on every state change. Off by default: building one runs every plugin's `summarize()`. |
| `auth` | `{ tokens, roles }` | `{}` | Named tokens and their command allowlists. Empty leaves the transport unauthenticated. See [Security posture](./security.md#configuring-tokens). |
| `allowedOrigins` | `string[]` | `["*"]` | Origins allowed to read responses cross-origin. Any list other than `["*"]` echoes a matching `Origin` and omits the header otherwise. |
| `allowUnauthenticated` | `boolean` | `false` | Permit binding a non-loopback `host` with no tokens configured. Off by default: that combination is a setup error. |

## Endpoints

Responses carry the CORS headers `allowedOrigins` implies — by default `Access-Control-Allow-Origin: *`.

When `auth.tokens` is configured, **every** route requires a token: `/status`, `/state`, `/events`, `/command`, and unknown paths all answer `401` without one. Preflights are the exception. Present a token as `Authorization: Bearer <token>` anywhere, or as `?access_token=<token>` on `GET /events` only. See [Security posture](./security.md) for the full model.

The routes are:

- **`GET /events`** — a Server-Sent Events stream of bus events, optionally interleaved with state push frames.
- **`POST /command`** — dispatches a command from `allowedCommands` and returns its result.
- **`GET /status`** — the same display-oriented snapshot as `launchpad status`, and the remote liveness check.
- **`GET /state`** — the full global state, only when `exposeState: true`.
- **`OPTIONS *`** — CORS preflight, answered before the auth gate.

The exact request/response shapes, every status code and error message, the SSE frame format, sequence-number and reconnect semantics, the `launchpad:state:patch` / `launchpad:status:snapshot` frames, and the command catalog (including `workflow.run` — see also [Workflows](./workflows.md#running-a-workflow-remotely)) are specified byte-for-byte in the **[Wire Contract](./wire-contract.md)**. That page is the one to hand a Unity/.NET or vendor-tooling developer implementing a client; this page is about turning the transport on and choosing its options.

A client can, at a glance, expect: connect to `GET /events` with a bearer token (or `?access_token=` if it's a browser), read `GET /status` to identify which Node it's talking to, and `POST /command` to trigger anything in `allowedCommands`. The one non-obvious rule worth knowing before you even open the wire contract: **every reconnect to `GET /events` should be treated as having possibly missed something** — re-read `GET /status`/`GET /state` after every `open`, never rely on `Last-Event-ID` (the server ignores it), and don't try to detect a gap by inspecting frame ids alone. The [Wire Contract's reconnection section](./wire-contract.md#sequence-numbers-and-reconnection) explains why in full, including the subtle failure mode a naive implementation hits.

## Security model

Loopback HTTP is not equivalent to the IPC transport's Unix socket. A Unix socket's reachability is gated by filesystem permissions on the socket path. A loopback TCP port is reachable by **any process on the machine**, and — because browsers allow `no-cors` cross-origin requests to complete even though the response body is opaque to the page — by drive-by JavaScript running in any tab the user has open, regardless of CORS headers. `POST /command` in particular can be triggered blind from a malicious page.

This is why the transport is deliberately conservative:

- **Tokens.** With `auth.tokens` configured, every route needs one, and each token's role narrows which commands it can dispatch. Binding a non-loopback `host` without tokens is a setup error.
- **Command allowlist.** Only `allowedCommands` can be dispatched; everything else is `403`. There is no way to widen this from the wire — only from config. Allowlisting `workflow.run` grants exactly the recipes declared in this Node's config: it takes a workflow name, never inline steps, so a client cannot compose a command sequence of its own.
- **No shutdown route.** Unlike the IPC transport, there is no way to stop the controller over HTTP.
- **`/state` is opt-in.** Full global state can contain more than a browser page should be able to read passively; it is `404` unless `exposeState: true`.
- **State push inherits that decision.** `pushStatePatches` requires `exposeState` and is off by default. Enabling it puts every plugin's state slice on the wire to every authenticated client, whatever its token role.

[Security posture](./security.md) covers the whole model: configuring tokens, role globs and how they intersect with `allowedCommands`, the `401`/`403` split, CORS, and the limitations you're accepting.

## Limitations

- **Task mode is a no-op.** One-shot CLI runs never bind a port; the transport only runs alongside a persistent controller.
- **JSON serialization is lossy.** Event payloads, command results, and pushed state go over a `JSON.stringify`-equivalent codec, not the [`devalue`](https://github.com/Rich-Harris/devalue) codec the IPC transport uses — `Map`/`Set`/functions/symbols/cycles degrade to placeholder strings, and neither `GET /state` nor a patch-built mirror matches a plugin's TypeScript type exactly. If you own a plugin's state shape, keep it JSON-native (several shipped slices already store `Date`s, which degrade silently to ISO strings with no placeholder to detect it by). The exact placeholder catalog a client needs to handle is in the [Wire Contract's serialization section](./wire-contract.md#serialization-and-lossiness).
- **Slow SSE clients may drop events.** Writes are fire-and-forget with no backpressure handling; a client that can't keep up may silently miss events. The manifest poll fallback covers this by design — see [Version Manifest](../content/version-manifest.md).
- **A failed port bind is a hard setup failure.** `EADDRINUSE` and similar bind errors fail plugin setup with no auto-recovery.
- **Events are transport-global.** Every authenticated SSE client receives every event passing the `events` filter, regardless of its token role. Keep role-sensitive data out of event payloads.
- **Status snapshots are expensive.** Building one runs every plugin's `summarize()`, and a content fetch produces many patch batches. Leave `pushStatusSnapshots` off unless a client actually needs it; there is no throttling or coalescing.
- **No TLS.** Traffic is plaintext HTTP, tokens included. See [Security posture](./security.md#the-v1-posture-trusted-vlan-plus-tokens).

See the [Wire Contract](./wire-contract.md) for the reconnect and gap-recovery rules a client must implement — including why `Last-Event-ID` doesn't help here — and for the full protocol spec behind every option above.
