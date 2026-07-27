---
title: "Transports"
---

# Transports

A transport is an ordinary controller plugin that exposes the command bus and event bus over some wire protocol. Launchpad ships two:

- **IPC transport** — a Unix socket (named pipe on Windows), gated by filesystem permissions. Used by the CLI to talk to a running `launchpad start` daemon.
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
> Push over `/events` is best-effort sugar on top of the [version manifest](/reference/content/version-manifest) poll contract. Applications must keep polling `<downloadPath>/manifest.json` — the HTTP transport is a lower-latency notification, not a replacement.

In task mode (one-shot CLI invocations) the plugin is inert and never binds a port. Options are still validated in task mode, so a malformed config (e.g. an out-of-range `port`) fails setup even though nothing is bound.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `8710` | Port to listen on. `0` picks a random free port (useful in tests). |
| `host` | `string` | `"127.0.0.1"` | Host/interface to bind. |
| `allowedCommands` | `string[]` | `["content.ack", "content.manifest.read"]` | Command types accepted by `POST /command`. Anything else is rejected with `403`. |
| `events` | `string[]` | `["content:*"]` | Event names forwarded to SSE clients. An entry ending in `*` prefix-matches everything before it; the single entry `*` matches all events; any other entry is an exact match. |
| `keepAliveMs` | `number` | `15000` | Interval between `: ping` SSE comment lines, keeping idle connections (and intermediate proxies) alive. |
| `maxClients` | `number` | `32` | Maximum concurrent SSE clients. Further `GET /events` requests get `503` once this is reached. |
| `exposeState` | `boolean` | `false` | Expose the full global state at `GET /state`. Off by default — see [Security model](#security-model). |

## Endpoints

All responses carry `Access-Control-Allow-Origin: *`.

### `GET /events`

Opens a Server-Sent Events stream. On connect, the transport writes:

1. A `retry: 2000` line, telling `EventSource` to wait 2 seconds before reconnecting after a drop.
2. A catch-up `content:version:promoted` event (see below), best-effort.

After that, every bus event matching the `events` option is forwarded as an SSE frame, and a `: ping` comment line is written every `keepAliveMs`.

If `maxClients` concurrent streams are already open, the request gets `503` instead of a stream.

#### Catch-up event

A newly connected client doesn't know the active version until the next promote. If `content:version:promoted` passes the `events` filter, the transport dispatches `content.manifest.read` immediately after connecting and, if it succeeds, emits a synthetic `content:version:promoted` event with `id` set to the manifest's `versionId`:

```
event: content:version:promoted
id: 20260714T153045Z
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

```

This is best-effort: it's silently skipped if the event is filtered out, `content.manifest.read` isn't a registered command, or the manifest isn't readable (no versioning, no promoted version yet, and so on).

### `POST /command`

Dispatches a command from `allowedCommands`. Body is JSON with at least a `type` field, capped at 64KB.

| Status | When |
| --- | --- |
| `200` | Command dispatched; body is `{ result }`. |
| `400` | Body isn't valid JSON, or has no string `type` field, or the request body couldn't be read. |
| `403` | `type` isn't in `allowedCommands`. |
| `413` | Body exceeds the 64KB limit. |
| `500` | The command dispatched but returned an error; body is `{ error: { name, message } }`. |

```bash
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -d '{"type":"content.manifest.read"}'
```

### `GET /status`

Returns the same display-oriented status snapshot as `launchpad status`, as JSON. A read failure is reported as `500`.

### `GET /state`

Returns the full global controller state as JSON. Returns `404` unless `exposeState: true` — see [Security model](#security-model). A read failure once exposed is reported as `500`.

### `OPTIONS *`

Answers any path with a `204` CORS preflight response (`GET, POST, OPTIONS`, `Content-Type` header allowed, cached 24h).

### Anything else

`404`, with `{ error: { message } }` naming the method and path.

## SSE wire format

```
retry: 2000

event: content:version:promoted
id: 20260714T153045Z
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

: ping

```

Multi-line data is framed with one `data:` field per line, so a payload with embedded newlines survives `EventSource` reassembly.

## Security model

Loopback HTTP is not equivalent to the IPC transport's Unix socket. A Unix socket's reachability is gated by filesystem permissions on the socket path. A loopback TCP port is reachable by **any process on the machine**, and — because browsers allow `no-cors` cross-origin requests to complete even though the response body is opaque to the page — by drive-by JavaScript running in any tab the user has open, regardless of CORS headers. `POST /command` in particular can be triggered blind from a malicious page.

This is why the transport is deliberately conservative:

- **Command allowlist.** Only `allowedCommands` can be dispatched; everything else is `403`. There is no way to widen this from the wire — only from config.
- **No shutdown route.** Unlike the IPC transport, there is no way to stop the controller over HTTP.
- **`/state` is opt-in.** Full global state can contain more than a browser page should be able to read passively; it is `404` unless `exposeState: true`.

Treat `port`/`host` and `allowedCommands` as the trust boundary. Don't allowlist a command with side effects you wouldn't want any local process to trigger.

## Limitations

- **Task mode is a no-op.** One-shot CLI runs never bind a port; the transport only runs alongside a persistent controller.
- **JSON serialization is lossy.** Event payloads and command results are serialized with `JSON.stringify`-equivalent semantics, not the [`devalue`](https://github.com/Rich-Harris/devalue) codec the IPC transport uses. Cycles, `Map`/`Set`, `undefined`, and other non-JSON values won't round-trip.
- **Slow SSE clients may drop events.** Writes are fire-and-forget with no backpressure handling; a client that can't keep up may silently miss events. The manifest poll fallback covers this by design — see [Version Manifest](/reference/content/version-manifest).
- **A failed port bind is a hard setup failure.** `EADDRINUSE` and similar bind errors fail plugin setup with no auto-recovery.
