---
title: "Transports"
---
A transport is a controller plugin that exposes the command bus and event bus over a wire protocol. Launchpad ships two:

- The IPC transport uses a Unix socket (a named pipe on Windows), gated by filesystem permissions. The CLI uses it to talk to a running `launchpad start` daemon.
- The HTTP/SSE transport (`httpTransport`) serves a small HTTP API on loopback for clients that can't open a Unix socket, such as browsers and Unity/.NET apps.

This page covers the HTTP/SSE transport.

## Adding the transport

Add `httpTransport` to the `plugins` array next to the plugins whose commands and events you want to expose:

```typescript
import { content } from "@bluecadet/launchpad/content";
import { httpTransport } from "@bluecadet/launchpad/controller/transports/http";

export default defineConfig({
  plugins: [content({ versioning: true }), httpTransport({ port: 8710 })],
});
```

> [!NOTE]
> Push over `/events` is a best-effort addition to the [version manifest](../content/version-manifest.md) poll contract. Applications must keep polling `<downloadPath>/manifest.json`; the HTTP transport only delivers notifications sooner.

In task mode (one-shot CLI runs) the plugin does nothing and never binds a port. It still validates options, so a malformed config, such as an out-of-range `port`, fails setup.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `8710` | Port to listen on. `0` picks a random free port, useful in tests. |
| `host` | `string` | `"127.0.0.1"` | Host/interface to bind. |
| `allowedCommands` | `string[]` | `["content.ack", "content.manifest.read"]` | Command types `POST /command` accepts. Others get `403`. |
| `events` | `string[]` | `["content:*"]` | Event names forwarded to SSE clients. An entry ending in `*` matches by prefix, `*` alone matches every event, and other entries match exactly. |
| `replayEvents` | `string[]` | `["content:version:promoted"]` | Event names replayed on connect. The transport keeps each listed event's last frame and sends it to new clients. An event must also pass the `events` filter. |
| `keepAliveMs` | `number` | `15000` | Interval between `: ping` SSE comment lines, which keep idle connections and proxies alive. |
| `maxClients` | `number` | `32` | Maximum concurrent SSE clients. Past this limit, `GET /events` returns `503`. |
| `exposeState` | `boolean` | `false` | Expose the full global state at `GET /state`. See [Security model](#security-model). |

## Endpoints

All responses carry `Access-Control-Allow-Origin: *`.

### `GET /events`

Opens a Server-Sent Events stream. On connect, the transport writes:

1. A `retry: 2000` line, which tells `EventSource` to wait 2 seconds before reconnecting after a drop.
2. The replay backlog, described below.

After that, the transport forwards every bus event that matches the `events` option as an SSE frame and writes a `: ping` comment line every `keepAliveMs`.

If `maxClients` streams are already open, the request gets `503`.

#### Replay on connect

Without replay, a client that connects between two emissions of an event learns nothing until the next one. The transport keeps the **last frame of each event name listed in `replayEvents`** and sends those frames to each new client before live streaming begins, in the order each event was last emitted. Events missing from `replayEvents` stream live only, whatever the `events` filter allows.

- Only `replayEvents` names are kept. By default that's `content:version:promoted`. Other events, such as `content:fetch:start`, still stream live through `GET /events` if `events` allows them, but a late client misses them.
- The transport keeps one frame per listed event name. A new emission replaces the stored frame.
- An event must also pass the `events` filter to be kept. Listing it in `replayEvents` doesn't override `events`.
- The backlog lives in memory and starts empty. Until a replayable event fires, a new client gets only the `retry:` line.

Replay lets a new browser or Unity client learn the active content version without waiting for the next fetch. The port opens during `setup()`, and the content plugin announces the active on-disk version shortly after, during the `ready()` phase. A client that connects in between receives the announcement live; a later client gets it from the backlog.

```
event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

```

### `POST /command`

Dispatches a command listed in `allowedCommands`. The body is JSON with at least a `type` field, up to 64KB.

| Status | When |
| --- | --- |
| `200` | Command dispatched; body is `{ result }`. |
| `400` | The body isn't valid JSON, has no string `type` field, or couldn't be read. |
| `403` | `type` isn't in `allowedCommands`. |
| `413` | Body exceeds the 64KB limit. |
| `500` | The command returned an error. Body is `{ error: { name, message, cause? } }`, with `cause` following the error chain. |

```bash
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -d '{"type":"content.manifest.read"}'
```

### `GET /status`

Returns the same display-oriented status snapshot as `launchpad status`, as JSON.

### `GET /state`

Returns the full global controller state as JSON, or `404` unless `exposeState: true`. See [Security model](#security-model).

### `OPTIONS *`

Answers any path with a `204` CORS preflight response that allows `GET, POST, OPTIONS` and the `Content-Type` header, cached for 24h.

### Anything else

Returns `404` with `{ error: { message } }` naming the method and path.

## SSE wire format

```
retry: 2000

event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

: ping

```

Multi-line data gets one `data:` field per line, so payloads with embedded newlines survive `EventSource` reassembly.

## Security model

Loopback HTTP is less protected than the IPC transport's Unix socket. Filesystem permissions on the socket path control who can reach a Unix socket. **Any process on the machine** can reach a loopback TCP port. So can JavaScript in any open browser tab, regardless of CORS headers, because browsers complete `no-cors` cross-origin requests and only hide the response body from the page. A malicious page can trigger `POST /command` blind.

The transport limits exposure accordingly:

- Only `allowedCommands` can be dispatched; everything else gets `403`. Only config can widen the list, never a request.
- HTTP has no shutdown route. Unlike the IPC transport, it can't stop the controller.
- `/state` is opt-in. Full global state can hold more than a browser page should read passively, so it returns `404` unless `exposeState: true`.

Treat `port`/`host` and `allowedCommands` as the trust boundary. Don't allowlist a command with side effects you wouldn't want any local process to trigger.

## Limitations

- Task mode does nothing. One-shot CLI runs never bind a port; the transport runs only with a persistent controller.
- JSON serialization is lossy. Event payloads and command results use `JSON.stringify` semantics, not the [`devalue`](https://github.com/Rich-Harris/devalue) codec the IPC transport uses. Cycles, `Map`/`Set`, `undefined`, and other non-JSON values don't round-trip.
- Slow SSE clients can drop events. Writes are fire-and-forget with no backpressure, so a client that can't keep up can silently miss events. Manifest polling covers this gap; see [Version manifest](../content/version-manifest.md).
- A failed port bind fails setup. `EADDRINUSE` and similar bind errors fail plugin setup with no automatic recovery.
