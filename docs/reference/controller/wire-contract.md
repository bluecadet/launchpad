---
title: "Wire Contract"
---
This page specifies the launchpad HTTP/SSE surface as a versioned wire contract: every request shape, response shape, status code, header, and recovery rule a client needs, independent of the TypeScript source. It is written for anyone implementing a client outside the launchpad codebase — a Unity/C# app, a vendor's dashboard, a `curl` script — with no access to (or need to read) `packages/controller`.

If you're configuring the transport itself — which options exist, their defaults, when to turn each on — see [Transports](./transports.md). This page is the protocol those options produce.

> [!NOTE]
> Out of scope for this document: OpenAPI schemas and client codegen. The contract is prose plus worked examples. See [Contract version and compatibility](#contract-version-and-compatibility) for why that's enough for v1.

## Contract version and compatibility

This document describes **wire contract v1**.

**Nothing on the wire currently advertises a version.** `GET /status` has no `version` field, no SSE frame carries one, and there is no `/version` endpoint. A client cannot ask the server "which contract version is this?" — it can only assume v1, because v1 is the only version that has ever shipped. If that changes, the addition of a version field is itself something this page will document as a compatibility mechanism at the time; until then, treat its absence as a known limitation, not a design a client should route around.

A client pins itself to v1 by implementing exactly what's below. There is no negotiation handshake to skip.

**A client built against v1 must tolerate, without breaking:**

- New event names appearing in an `events: ["*"]` (or otherwise broadened) stream.
- New fields appended to any existing JSON object — `GET /status`, `GET /state`, command results, SSE frame payloads. Parse leniently; don't reject on unrecognized keys, and don't assume a fixed key order.
- New commands becoming available (a new `allowedCommands` entry, a new token role).
- New `[unserializable: <kind>]` placeholder strings beyond the ones catalogued in [Serialization and lossiness](#serialization-and-lossiness). The prefix `[unserializable` is the stable part; the kind that follows it is not enumerable and may grow.
- New optional query parameters or request headers the server accepts but a v1 client doesn't send.

**The following would be a breaking change, requiring a new contract version:**

- Removing or renaming a field, endpoint, command, event name, status code, or SSE frame name documented here.
- Changing a field's type or meaning (e.g. `steps[].error` changing from `string | null` to a structured object).
- Changing the sequencing rules in [Sequence numbers and reconnection](#sequence-numbers-and-reconnection) or the `_version` rules in [State push frames](#state-push-frames) — a client's recovery logic depends on the exact semantics, not just the field names.
- Changing the patch format in [`launchpad:state:patch`](#launchpadstatepatch) away from Immer patches, or changing what `path` segments mean.
- Narrowing what a client is currently allowed to assume tolerantly (e.g. if fields were ever guaranteed to appear in a fixed order and that guarantee were revoked with no replacement).

Additive changes ship in a minor release of `@bluecadet/launchpad-controller`; breaking changes ship in a major release and this page's contract version number moves to v2, with the two documented side by side for the deprecation window.

## Connecting

The transport is plain HTTP (no TLS in v1 — see [Security posture](./security.md#the-v1-posture-trusted-vlan-plus-tokens)) on a host and port an operator configures, `127.0.0.1:8710` by default. Every example on this page assumes that default; substitute your deployment's host and port.

There are five routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/events` | Server-Sent Events stream: bus events plus optional state push. |
| `POST` | `/command` | Dispatch a command, get its result back in the response. |
| `GET` | `/status` | Display-oriented status snapshot; also the liveness check. |
| `GET` | `/state` | Full global state (only if the operator opted in). |
| `OPTIONS` | any path | CORS preflight. |

Any other method/path pair is `404`.

## Authentication

If the operator configured `auth.tokens`, every route below requires a bearer token — including `/status`, `/state`, `/events`, `POST /command`, and even unknown paths. If no tokens are configured, the transport is open and every request is treated as anonymous. There is no way for a client to detect which mode it's in except by trying a request and reading the status code.

Present a token as an `Authorization` header on any route:

```
Authorization: Bearer 3f9c1a7e2b4d5f60718293a4b5c6d7e8
```

The `Bearer` scheme match is case-insensitive (`bearer`, `BEARER`, `Bearer` all work); anything else, or a header with no space-separated scheme, is treated as no token presented.

`GET /events` **only** also accepts the token as a query parameter, because browser `EventSource` cannot set request headers:

```
GET /events?access_token=3f9c1a7e2b4d5f60718293a4b5c6d7e8
```

Sending `?access_token=` on any other route does nothing — it is not read there, so the request is treated as unauthenticated and gets `401` if tokens are required. Don't use it outside `/events`.

**Failure.** A missing or unrecognized token gets:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
Content-Type: application/json

{"error":{"message":"Unauthorized"}}
```

**Any valid token is a full-read credential.** A token's role only ever gates `POST /command` — see [Dispatching a command](#dispatching-a-command). Every valid token, regardless of role, can read `GET /status`, `GET /state`, and the full `GET /events` stream. There is no way to give a token read access to some events but not others, or to `/state` but not `/events` — it's all or nothing per token, scoped only by whether the token is valid at all.

A client cannot map the API by status code: an unrecognized path also answers `401` before `404` when auth is on, so probing routes without a token teaches you nothing about what exists.

## Node identity

Every daemon (a "Node") has an identity object, present in both `GET /status` and `GET /state`:

```typescript
type NodeIdentity = {
  id: string;      // stable identifier; defaults to a sanitized short hostname
  label: string;    // human-readable name; defaults to the resolved `id`
  role?: string;    // free-form deployment tag; ABSENT (not null) when unset
};
```

`role` is omitted from the JSON object entirely when the operator hasn't configured one — a client checking for it should test `"role" in node` or use optional-chaining, not compare against `null`. `id` and `label` are always present and are fixed for the daemon's lifetime; they never change without a restart.

`GET /status` surfaces this as `header.node`; `GET /state` surfaces the identical object as `system.node`.

## Endpoints

### `GET /status`

Always available (subject to auth). Returns the same display-oriented snapshot `launchpad status` prints, as JSON:

```json
{
  "header": {
    "startTime": "2026-07-14T15:30:47.112Z",
    "uptimeMs": 8100000,
    "mode": "persistent",
    "node": { "id": "gallery-kiosk-1", "label": "Gallery Kiosk 1", "role": "exhibit" }
  },
  "sections": [
    { "name": "content", "order": 10, "title": "Content", "rows": [] }
  ]
}
```

- `header.startTime` — ISO 8601 timestamp of daemon boot.
- `header.uptimeMs` — milliseconds since boot, computed fresh on every request.
- `header.mode` — `"persistent"` or `"task"`.
- `header.node` — see [Node identity](#node-identity).
- `sections` — an array of `{ name, order?, title, rows }`. `rows` is a small display tree (`{type:"kv"|"list"|"text", ...}`) meant for a status display, not a stable data API — treat it as informational and don't build critical logic on its shape.

This is the remote liveness check: there is no separate unauthenticated health route. One round trip answers "is this Node up" and "which Node is it" via `header.node.id`, which matters once a client is polling more than one Node. Building the snapshot runs every plugin's `summarize()`, so a 1 Hz poll of a handful of Nodes is fine; a 10 Hz poll is not free.

Always `200` when reachable and authenticated; there is no other status code specific to this route.

### `GET /state`

Returns `404` unless the operator set `exposeState: true`:

```json
{"error":{"message":"Not found: GET /state"}}
```

When enabled, returns the full aggregated state as JSON — see [State shape](#state-shape) for the schema, and [Serialization and lossiness](#serialization-and-lossiness) for what doesn't survive the trip. Always `200` when enabled and authenticated.

This is the recovery endpoint: any time your local mirror of state is suspected stale (see [Sequence numbers and reconnection](#sequence-numbers-and-reconnection)), re-fetch this and rebuild your mirror from scratch.

### `POST /command`

Dispatches a command. Body is JSON, at least `{"type": "<command-id>"}`, capped at 64KB.

```bash
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LAUNCHPAD_TOKEN_DOCENT" \
  -d '{"type":"content.manifest.read"}'
```

```json
{"result":{"status":"ok","manifest":{"schemaVersion":1,"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z","sources":[{"sourceId":"exhibits","path":"exhibits"}]}}}
```

| Status | Body | When |
| --- | --- | --- |
| `200` | `{"result": <value>}` | Command dispatched and resolved. `result` is always present, even for a command that resolves with nothing — see [the `result` presence guarantee](#the-result-presence-guarantee). |
| `400` | `{"error":{"message":"Request body must be JSON with a string \"type\""}}` | Body isn't valid JSON, or has no string `type` field. |
| `400` | `{"error":{"message":"Failed to read request body"}}` | The request stream errored while reading. |
| `401` | `{"error":{"message":"Unauthorized"}}` | No valid token, when tokens are required. |
| `403` | `{"error":{"message":"Command not allowed: <type>"}}` | `type` isn't in the transport's `allowedCommands`. This gate runs first and applies to every caller, including an anonymous one on an unauthenticated transport. |
| `403` | `{"error":{"message":"Command not permitted for role \"<role>\": <type>"}}` | The token is valid, but its role's command globs don't cover `type`. |
| `413` | `{"error":{"message":"Request body exceeds 64KB limit"}}` | Body exceeded 64KB. |
| `500` | `{"error":{"name":"CommandExecutionError","message":"<see below>", ...}}` | Something went wrong past the `allowedCommands`/role gates — an unregistered command, invalid params, or a handler failure. See [the three cases below](#every-command-failure-has-name-commandexecutionerror-at-the-top-level) for exactly which, and where the actionable detail lives. |

A `403` for "not allowed" is checked before role authorization, so it fires even for a caller presenting no token at all (on an unauthenticated transport, `allowedCommands` is still enforced — a role is not the only gate). See [Dispatching a command](#dispatching-a-command) for the full authorization model and [Commands reference](#commands-reference) for the shipped command catalog.

#### Every command failure has `name: "CommandExecutionError"` at the top level

A command's own logic error — a `WorkflowError`, a content-plugin error, whatever the handler throws or resolves as `err(...)` — never reaches the wire as the **top-level** `error` object. The dispatcher always wraps a `500` in a `CommandExecutionError` first, so `error.name` is always `"CommandExecutionError"` and tells you nothing about *why* — you must read further in. There are three distinct cases, distinguishable by `error.message`:

| `error.message` | Meaning | `error.cause` |
| --- | --- | --- |
| `Command '<type>' is not registered` | `<type>` passed `allowedCommands` and the token role, but no plugin actually implements it (an operator misconfiguration — `allowedCommands` doesn't guarantee a command exists). | Absent. |
| `Invalid command: <type>` | The request's `type` and top-level shape were fine, but the command's own parameters failed its schema (e.g. a missing `consumerId` on `content.ack`). | A **`ZodError`**: `{"name":"ZodError","message":"<JSON-formatted array of validation issues>"}`. `cause.message` is itself a pretty-printed JSON string (not a plain sentence) listing every failed field, each with its own `path` (array), `code`, and `message` — parse it as JSON if you want structured detail, or show it as-is for debugging. |
| `Plugin command execution failed` | The command was well-formed and dispatched, but the handler itself failed (business logic, an I/O error, a workflow step failing, etc.). | The plugin's actual error, e.g. `{"name":"WorkflowError","message":"Workflow 'tour-mode' failed: step 2 (content.fetch): fetch timed out after 30000ms"}`. |

**A client that wants the specific, actionable reason for a `500` must read `error.cause`, not `error.message`** — the top-level `message` only tells you which of these three buckets you're in. `cause` (when present) follows the normal `Error` recursion rule from [Serialization and lossiness](#serialization-and-lossiness): it can itself carry one more nested `cause`, if the underlying error chained one.

There is **no correlation id** anywhere in this protocol. A command's result is correlated to its request purely by the HTTP request/response pair, and there is no async command mode.

Commands don't appear on the SSE stream *by default* — the default `events: ["content:*"]` doesn't forward them — but they aren't structurally excluded from it either. The controller emits `command:start` (carrying the full command, params included), `command:success` (carrying the full result), and `command:error` (carrying the full error) on the same event bus the HTTP transport listens to, and none of those three names start with the reserved `launchpad:` prefix. An operator who broadens `events` to `*` (or adds `command:*`) forwards every command's params, result, or error to **every connected client holding any valid token**, regardless of that token's role — a role only ever gates *dispatching* a command over `POST /command`, never *reading* the SSE stream (see [Authentication](#authentication)). Treat a broadened `events` filter as a real information-leak vector, not just a noisier stream.

#### The `result` presence guarantee

A `200` response always has a `result` key, even when the command's handler resolves with nothing. `content.ack` is one such command: it succeeds by resolving `undefined`, and the transport normalizes that to `"result": null` on the wire, rather than dropping the key the way plain `JSON.stringify({ result: undefined })` would. A client can always deserialize `result` as present on `200` — never write code that treats a missing `result` key as a valid success case.

One consequence worth knowing: this normalization means a command that legitimately resolves `null` and a command that resolves `undefined` (void) are indistinguishable on the wire — both are `"result": null`. That collapse is deliberate; if you need to tell "no result" apart from "resolved with null" for a specific command, that distinction has to live in the command's own result shape (e.g. wrapping it in `{ status: "ok" }` or similar), not in this transport-level guarantee.

### `GET /events`

Opens a Server-Sent Events stream (`Content-Type: text/event-stream`, `Cache-Control: no-store`). See [SSE wire format](#sse-wire-format) for frame anatomy and [Sequence numbers and reconnection](#sequence-numbers-and-reconnection) for the recovery contract — both are required reading before writing a client against this route.

If the transport already has its configured maximum number of concurrent SSE clients open, the request gets:

```
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{"error":{"message":"Too many SSE clients"}}
```

Otherwise the connection stays open indefinitely (subject to `keepAliveMs` pings) until the client disconnects or the server shuts down.

### `OPTIONS *`

Answers any path, including ones that don't otherwise exist, with a CORS preflight response:

```
HTTP/1.1 204 No Content
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
```

This is answered **before** the auth gate — browsers never attach `Authorization` to a preflight, so a `401` here would break every browser client before its real request was ever sent. A non-browser client has no reason to send `OPTIONS` at all.

### Unknown routes

Any method/path combination not listed above:

```
HTTP/1.1 404 Not Found
Content-Type: application/json

{"error":{"message":"Not found: GET /widgets"}}
```

The message interpolates the exact method and path requested. This still requires a valid token first if the transport has auth configured — see [Authentication](#authentication).

### CORS headers on every response

Every response (including error responses) carries the CORS headers implied by the operator's `allowedOrigins` config: `Access-Control-Allow-Origin: *` by default, or an echoed `Origin` with `Vary: Origin` when the operator restricted it. This only affects whether a **browser** page in another origin can read the response body — it has no effect on a non-browser client (Unity, `curl`, a vendor's native app), and a mismatched origin does not stop the request from executing server-side. Don't treat CORS as an authorization mechanism; that's what tokens are for.

## Dispatching a command

Two independent gates apply to every `POST /command`, in this order:

1. **`allowedCommands`.** The transport has a configured allowlist of command types it will dispatch at all (default: `content.ack`, `content.manifest.read`). A `type` outside it is `403 Command not allowed: <type>` for every caller — this gate has nothing to do with tokens and applies even when the transport has no auth configured.
2. **Token role**, only if a token was presented. Each token has exactly one role, and each role is a list of command-id prefix globs (same syntax as everywhere else on this page — see [Glob syntax](#glob-syntax)). The **effective** permission is `allowedCommands ∩ role globs`: a role can only ever narrow what's already allowed, never widen it. A command outside the role's globs is `403 Command not permitted for role "<role>": <type>`.

An anonymous caller on an unauthenticated transport only faces gate 1. There is no way to reach gate 2 without presenting a valid token.

### Glob syntax

Used identically for the transport's `events` filter, its `allowedCommands` list, and every token role's command list:

- An entry ending in `*` is a prefix match: `"workflow.*"` matches `workflow.run` and `workflow.list`.
- The single entry `*` matches everything.
- Any other entry is an exact match.
- An empty list matches nothing — a role with `[]` is a valid, fully read-only token.

## Commands reference

A command request is `{"type": "<id>", ...params}` where `id` always has the shape `<namespace>.<verb>` (e.g. `content.ack`, `workflow.run`).

Only `workflow.run` and `workflow.list` are genuinely core: the controller registers them itself, before any host plugin, on every deployment regardless of config. `content.ack` and `content.manifest.read` are registered by the **optional** `content` plugin — they only exist on a Node whose config actually includes `content(...)`. A project's own plugins (e.g. `monitor.*`) register still more commands, and are documented by the project, not here.

> [!WARNING]
> `content.ack` and `content.manifest.read` are also the transport's *default* `allowedCommands` — but being in `allowedCommands` only means a command is allowed past that gate, never that it's registered. On a Node that never added the `content` plugin, both still pass `allowedCommands` and any role check, then fail at dispatch with a `500` and `error.cause` absent: `{"error":{"name":"CommandExecutionError","message":"Command 'content.manifest.read' is not registered"}}` (the "not registered" row of [the table above](#every-command-failure-has-name-commandexecutionerror-at-the-top-level)). A client cannot assume a command exists just because it's allowlisted — the only reliable check is trying it, or something project-specific like a successful `content.manifest.read` earlier in a session.

### `content.ack`

Default-allowed. Extends a content-retention lease for a consumer on a specific version.

Request:

```json
{"type":"content.ack","consumerId":"unity-player-1","versionId":"20260714T153045Z"}
```

Response: `{"result": null}` — the handler resolves with nothing; see [the `result` presence guarantee](#the-result-presence-guarantee). `consumerId` and `versionId` are both required, non-empty strings.

### `content.manifest.read`

Default-allowed. Reads the active version manifest.

Request:

```json
{"type":"content.manifest.read"}
```

Response is one of three shapes:

```json
{"result":{"status":"ok","manifest":{"schemaVersion":1,"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z","sources":[{"sourceId":"exhibits","path":"exhibits"}]}}}
```

```json
{"result":{"status":"missing"}}
```

```json
{"result":{"status":"invalid","message":"<parse failure detail>"}}
```

`status: "missing"` means the manifest file doesn't exist yet (versioning may be disabled, or nothing has published yet). `status: "invalid"` means a manifest file exists but failed to parse; `message` is a plain string, not a structured error.

### `workflow.run`

Not in the default `allowedCommands` — an operator opts in explicitly (commonly paired with a `workflow.*` role glob, since both workflow commands share that prefix deliberately). Runs a config-declared workflow by name and resolves with its full run record. It **never** accepts inline steps — a client cannot compose its own command sequence, only trigger a Node-declared one.

Request:

```json
{"type":"workflow.run","name":"tour-mode"}
```

Response:

```json
{
  "result": {
    "runId": 3,
    "name": "tour-mode",
    "status": "success",
    "startedAt": "2026-07-14T15:31:02.004Z",
    "finishedAt": "2026-07-14T15:31:04.881Z",
    "durationMs": 2877,
    "stepCount": 3,
    "steps": [
      { "index": 0, "command": "monitor.stop", "status": "success", "durationMs": 412, "error": null },
      { "index": 1, "command": "content.fetch", "status": "success", "durationMs": 2103, "error": null },
      { "index": 2, "command": "monitor.start", "status": "success", "durationMs": 362, "error": null }
    ],
    "error": null
  }
}
```

```typescript
type WorkflowRun = {
  runId: number;                 // monotonic per controller process, starting at 1; resets on restart
  name: string;
  status: "running" | "success" | "error";
  startedAt: string;             // ISO 8601
  finishedAt: string | null;     // ISO 8601, or null while status is "running"
  durationMs: number | null;     // null while status is "running"
  stepCount: number;
  steps: {
    index: number;
    command: string;             // the step's command type, as declared in config
    status: "success" | "error" | "skipped";
    durationMs: number;          // 0 for a skipped step
    error: string | null;        // plain message; null unless status is "error"
  }[];
  error: string | null;          // aggregated failure message; null on success or while running
};
```

Three things can go wrong here, each answering with a `500` under [the "execution failed" case above](#every-command-failure-has-name-commandexecutionerror-at-the-top-level) — the only difference is `error.cause.message`:

- **Unknown workflow name.** `error.cause.message` is exactly `Unknown workflow '<name>'`.
- **A second `workflow.run` for a name already in flight.** `error.cause.message` is exactly `Workflow '<name>' is already running`. No run record is produced by this call in either of these first two cases.
- **The run started but a step failed.** `error.cause.message` is `Workflow '<name>' failed: step <n> (<command>): <detail>`, e.g.:

  ```json
  {"error":{"name":"CommandExecutionError","message":"Plugin command execution failed","cause":{"name":"WorkflowError","message":"Workflow 'tour-mode' failed: step 2 (content.fetch): fetch timed out after 30000ms"}}}
  ```

  This is the only one of the three where a run record actually exists — `error.cause.message` carries only that one summary line, not the full per-step detail. To learn which step failed (or a workflow's run history at all), call `workflow.list` (below) or read `plugins.workflows.runs.<name>` from `GET /state` afterward — the run record persists in state regardless of how the triggering request resolved.

### `workflow.list`

Same allowlisting story as `workflow.run`. Lists every workflow this Node knows about and each one's most recent run.

Request:

```json
{"type":"workflow.list"}
```

Response:

```json
{
  "result": {
    "workflows": [
      { "name": "start", "stepCount": 3, "lastRun": null },
      {
        "name": "tour-mode",
        "stepCount": 3,
        "lastRun": {
          "runId": 3,
          "name": "tour-mode",
          "status": "success",
          "startedAt": "2026-07-14T15:31:02.004Z",
          "finishedAt": "2026-07-14T15:31:04.881Z",
          "durationMs": 2877,
          "stepCount": 3,
          "steps": [],
          "error": null
        }
      }
    ]
  }
}
```

`lastRun` is `null` if the workflow hasn't run in this process — there is no run history across a restart, and only the single most recent run per name is kept even within one process.

## SSE wire format

Every SSE response begins with a `retry:` line, written once, immediately on connect — not repeated per frame:

```
retry: 2000

```

That tells `EventSource` to wait 2 seconds before auto-reconnecting after a drop. After that, frames arrive as the stream runs. A general frame has this shape:

```
id: 42
event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

```

- `id:` — present on every **broadcast** frame (see [Sequence numbers and reconnection](#sequence-numbers-and-reconnection)); **absent** on the replay backlog, and never present on `retry:` lines or `: ping` comments.
- `event:` — the event name. Names under the `launchpad:` prefix are reserved for transport-generated frames (state push); a plugin's own bus event can never use that prefix — the transport drops it and logs a warning instead of forwarding it.
- `data:` — one `data:` line per line of the JSON payload. A payload with embedded newlines produces multiple `data:` lines for one frame; a standards-compliant `EventSource` reassembles them with `\n` joins before your handler sees the string.
- A blank line terminates the frame.
- `: ping` — a bare SSE comment line, written every `keepAliveMs` (default 15000ms) to keep the connection (and any intermediate proxy) alive. It never reaches an `EventSource` `message` handler; comments are invisible to the SSE parsing spec. Don't expect an event for it.

### Replay on connect

A client that connects between two emissions of some event would otherwise learn nothing about it until the next one fires. To close that gap, the transport remembers the **last frame of each event name the operator configured for replay** and sends those remembered frames — in the order each was last emitted — to every newly connected client, before live streaming begins. An event not configured for replay streams live only; it is never replayed, no matter how the server's event filter is configured to forward it.

Consequences worth building a client around:

- **Only specifically-configured event names are ever remembered.** A default deployment remembers just `content:version:promoted`; other event names still arrive live if the server forwards them at all, but connecting late means missing them entirely — there is no general-purpose backlog.
- **One frame per remembered event name.** A second emission overwrites the remembered frame; you will never receive two backlog frames for the same event name.
- **The backlog lives in server memory and starts empty.** A client connecting before the server has ever emitted a given replayable event gets nothing for it — not even an empty placeholder frame — until the first live emission happens.
- **Replayed frames carry no `id:`.** They are not part of the sequence-number stream at all — see [Sequence numbers and reconnection](#sequence-numbers-and-reconnection), and read it before assuming you can tell a replayed frame apart from a live one by inspecting anything other than the presence of `id:` in the raw frame text itself (a parsed `EventSource` event cannot make this distinction — that's the whole reason the next section says what it says).

Here is a realistic run of frames back to back, exactly as they'd appear on the wire (a fresh connection, one replayed event, then a live promote with state push enabled):

```
retry: 2000

event: content:version:promoted
data: {"versionId":"20260714T091203Z","versionPath":"versions/20260714T091203Z","generatedAt":"2026-07-14T09:12:05.004Z"}

id: 12
event: content:version:promoted
data: {"versionId":"20260714T153045Z","versionPath":"versions/20260714T153045Z","generatedAt":"2026-07-14T15:30:47.112Z"}

id: 13
event: launchpad:state:patch
data: {"patches":[{"op":"replace","path":["plugins","content","activeVersion"],"value":"20260714T153045Z"}],"version":19}

id: 14
event: launchpad:status:snapshot
data: {"header":{"startTime":"2026-07-14T15:30:47.112Z","uptimeMs":8100000,"mode":"persistent","node":{"id":"gallery-kiosk-1","label":"Gallery Kiosk 1"}},"sections":[]}

: ping

```

Read the second frame carefully: it's the replay backlog (the last-known `content:version:promoted`, replayed because that event name is in the transport's `replayEvents`), and it carries **no `id:`**. The third frame is the first live, sequenced frame this client sees, and its `id` is whatever the transport's global counter happened to be at — here `12`, not `1`. That's not a gap; it's just where the counter already was. This is the crux of the next section.

## Sequence numbers and reconnection

Every **broadcast** SSE frame — every forwarded bus event, plus the two state-push frame types below — carries a monotonic `id:`. The rules a client must implement to use it correctly:

- **One counter, shared by every connected client, per transport process.** Two clients connected at the same moment see the same `id` on the same frame. It is **not** per-event-name: with the default `events: ["content:*"]`, a single content fetch can emit a dozen forwarded frames, and a client that only reacts to `content:version:promoted` sees the id jump by that much on every promote — that is not a gap, it's other frames the same counter also covers. Either account for every frame name the transport forwards (including the two `launchpad:` frames when state push is on), or ask the operator to narrow `events` server-side to exactly what you consume.
- **Never assume the first `id` you see is `1`.** Baseline on whatever the first `id` your connection receives actually is, and compare every subsequent one to `previous + 1` from there.
- **A gap is `id !== previous + 1`, in either direction.** Higher than expected means frames were missed. Lower than expected also means something: the daemon restarted and its counter reset to `0`.
- **A gap is a signal to re-query, not to ask for a replay.** There is no ring buffer and nothing to request retroactively. On any detected gap, re-fetch the authoritative source — `GET /status`, `GET /state`, or whichever command tells you what you need — and rebuild your local view from that response.
- **`Last-Event-ID` is ignored by the server.** A `.NET`/browser SSE client that tries to resume a dropped connection by sending this header (which `EventSource` does automatically on reconnect) gets nothing back for it — no code on the server reads it. Reconnecting always starts a brand-new stream with a brand-new baseline; it is not a resume.
- **You cannot detect the replay backlog by inspecting `id`s, and this is the mistake to not make.** A browser `EventSource` reports the *last id it ever received* as `lastEventId` on **every subsequent event, including unsequenced ones** — so a replayed frame arriving right after you reconnect carries the stale `id` left over from before the drop, and is indistinguishable from a genuine gap by inspecting the id alone. **Therefore: treat every reconnect as a gap, unconditionally.** Don't try to be clever about whether the first frame after `open` "looks like" a gap — rebaseline (forget your last-seen id) and re-fetch the authoritative source on every `open` event after the first. The frame immediately following a reconnect may itself look like one more gap once you've refetched and reset your baseline; that's expected — a spurious extra re-fetch costs one request, and re-fetching is idempotent.
- **Only broadcast frames consume a sequence number.** An event that the transport's `events` filter drops, and any frame produced while zero clients are connected, burns nothing. `retry:`, `: ping`, and replay-backlog frames never carry an `id` and never advance anyone's baseline.
- **A real `id` is never `0`.** The counter starts at `0` but is incremented *before* the first frame is ever broadcast, so the lowest id any client can legitimately see is `1`. A parsed `EventSource` event's `lastEventId` defaults to `""` before any `id:`-bearing frame has arrived — including for an untagged replay-backlog frame, which never sets it — and `Number("")` is `0`. That collision is useful: an observed `seq` of `0` can never be a genuine frame, so it's safe to ignore for baselining purposes even though you can't otherwise tell a replay frame from a live one (see above).

Reference implementation of the reconnect rule. Two things below are easy to get wrong and are exactly why they're written out explicitly: whether this is the client's first-ever connection must be tracked in its own flag, not inferred from `lastSeq` (a reconnect that hasn't yet seen a sequenced frame also has `lastSeq === undefined`, and silently skipping its refetch would contradict "every reconnect is a gap"); and a `seq` of `0` — including from an untagged replay frame — must never be allowed to seed a baseline.

```javascript
let hasConnectedBefore = false; // independent of lastSeq -- see below
let lastSeq; // undefined until a frame with a real id (>= 1) sets a baseline

function onSequencedEvent(event) {
  const seq = Number(event.lastEventId);
  // 0 is never a real id (see "A real `id` is never `0`" above); this is
  // either an untagged replay frame or the pre-connection default, and
  // either way it must not be allowed to seed or satisfy a baseline.
  if (seq === 0) return;

  const isGap = lastSeq !== undefined && seq !== lastSeq + 1;
  lastSeq = seq;
  if (isGap) refetchAuthoritativeState();
}

eventSource.addEventListener("open", () => {
  if (!hasConnectedBefore) {
    hasConnectedBefore = true; // first connect ever: nothing to resync yet
    return;
  }
  lastSeq = undefined;             // forget the stale baseline unconditionally
  refetchAuthoritativeState();     // every reconnect is a gap -- see above
});
```

## State shape

`GET /state` and every `launchpad:state:patch` frame describe the same tree:

```typescript
type VersionedLaunchpadState = {
  system: {
    startTime: string;   // ISO 8601 (a `Date` on the server side; serializes to a string)
    mode: "persistent" | "task";
    node: NodeIdentity;  // see Node identity, above
    // additional system fields may be present; treat unknown keys as informational
  };
  plugins: {
    [pluginName: string]: unknown; // each plugin's own state shape; opaque to the transport
  };
  _version: number; // see State push frames, below
};
```

`_version` is a single counter shared across **every** plugin's state slice, starting at `0` and incrementing once per patch batch — not once per plugin, not once per field. `system` is never itself the subject of a patch: only plugin slices under `plugins` generate patches, so `system` fields (including `node` and `startTime`) are guaranteed identical whether you read them from a fresh `GET /state` or from a state mirror built entirely from patches.

## State push frames

Two SSE frame types push state changes, both opt-in and both off by default (see [Transports: `pushStatePatches` / `pushStatusSnapshots`](./transports.md#options)). When both are enabled, the patch frame is always broadcast immediately before the snapshot frame, on consecutive `id`s — see the [worked wire dump](#sse-wire-format) above.

### `launchpad:state:patch`

```json
{"patches":[{"op":"replace","path":["plugins","content","activeVersion"],"value":"20260714T153045Z"}],"version":19}
```

```typescript
type StatePatchFrame = {
  patches: {
    op: "replace" | "add" | "remove";
    path: (string | number)[];
    value?: unknown; // present for "replace" and "add"; absent for "remove"
  }[];
  version: number; // the state store's _version after applying these patches
};
```

> [!WARNING]
> **`patches` is [Immer](https://immerjs.github.io/immer/)'s patch format, not RFC 6902 JSON Patch.** These look similar and are not interchangeable. The field is called `path`, singular, and it is a **JavaScript array** of string/number segments — `["plugins", "content", "activeVersion"]` — never a `/`-delimited string like JSON Patch's `"/plugins/content/activeVersion"`. A C# implementation that deserializes `path` as a single string, or feeds these patches into an RFC 6902 JSON Patch library, will fail silently or throw. Write your own small apply function; it only needs to handle three `op` values:
>
> - `"replace"` — the value at `path` already exists; overwrite it with `value`.
> - `"add"` — insert `value` at `path` (a new object key, or an array insertion at an index).
> - `"remove"` — delete whatever is at `path`; no `value` is present.
>
> `path` segments are applied left to right against your local mirror of `GET /state`, same as any JSON pointer-style walk, just array-typed instead of string-typed: `["plugins","content","activeVersion"]` means "navigate `.plugins.content`, then set/insert/remove the `activeVersion` key."

If `version` in an incoming patch frame is not `previous + 1`, your local mirror is stale — re-fetch `GET /state` and rebuild the mirror from scratch, the same way a sequence-number gap triggers a rebuild (see [Sequence numbers and reconnection](#sequence-numbers-and-reconnection)). This is exactly why `pushStatePatches` requires the operator to also enable `exposeState`: without `GET /state`, a client that detects a `version` gap would have no way back.

### `launchpad:status:snapshot`

Identical body to [`GET /status`](#get-status):

```json
{"header":{"startTime":"2026-07-14T15:30:47.112Z","uptimeMs":8100000,"mode":"persistent","node":{"id":"gallery-kiosk-1","label":"Gallery Kiosk 1"}},"sections":[]}
```

Pushed on every state change if the operator enabled `pushStatusSnapshots`, independent of whether `launchpad:state:patch` is also enabled. Has no `version` field of its own; if you need gap detection for this frame type, correlate it with the `id:` sequence number it's broadcast under (see [Sequence numbers and reconnection](#sequence-numbers-and-reconnection)) — its content itself carries no versioning.

## Serialization and lossiness

Everything served over HTTP — command results, `GET /status`, `GET /state`, and every SSE frame payload — goes through a lossy, one-way JSON codec. It never round-trips back into the original server-side value, and it never throws; instead, values `JSON.stringify` can't represent natively degrade to one of these placeholders. Every placeholder shares the prefix `[unserializable`, so you can detect *that* something degraded even before you know *what*:

| Original value | Wire representation |
| --- | --- |
| `Date` | ISO 8601 string (native `Date.toJSON()` — this one does **not** produce a placeholder and is indistinguishable from a plain string) |
| `bigint` | Decimal string, e.g. `"12345678901234567890"` |
| `Map` | `"[unserializable: map]"` |
| `Set` | `"[unserializable: set]"` |
| `function` | `"[unserializable: function <name>]"`, or `"[unserializable: function anonymous]"` for an anonymous function |
| `symbol` | `"[unserializable: symbol <description>]"`, or `"[unserializable: symbol anonymous]"` for one with no description |
| Any repeated object reference (a true cycle, **or** the same object reachable twice in a DAG without being circular) | `"[unserializable: circular]"` |
| `Error` | `{"name": "...", "message": "...", "cause"?: <same shape, recursed>}` — `cause` is included and recursed only when it is itself an `Error`; otherwise it's omitted entirely, not `null`. |
| A value whose serialization itself throws (a throwing getter, a throwing `toJSON`, or exceeding the call stack on extremely deep input) | The **entire response body** becomes a bare JSON string: `"[unserializable JSON payload: <error message>]"` — not an object, not wrapped in `{"error":...}`. A client that always expects a JSON object at the top level must guard against a bare string here. |

> [!NOTE]
> `Promise` has no special handling in this codec and produces no placeholder — a Promise value in state or a command result serializes as `{}` (it has no enumerable own properties), silently and indistinguishably from an empty plain object. If you control a plugin's state shape, don't put a `Promise` in it; there's nothing on the wire to detect that it happened.

## Reference: cross-cutting rules

A few rules apply across every route rather than to one:

- **Auth gates everything uniformly.** A client cannot distinguish "route doesn't exist" from "route exists but I lack a token" by status code alone when auth is on — both surface as the auth failure first.
- **CORS never blocks a non-browser client**, and never blocks the request from executing — it only controls whether a browser page is allowed to read the response.
- **There is no correlation id, and commands are not structurally excluded from the event stream.** `POST /command`'s request/response pair is the correlation mechanism, and commands don't appear on SSE under the default `events` filter — but `command:start`/`command:success`/`command:error` are ordinary bus events with no `launchpad:` prefix, so broadening `events` to `*` or `command:*` forwards every command's params, result, or error to every connected client, regardless of token role. See [the note in `POST /command`](#post-command).
- **Nothing here is throttled beyond `keepAliveMs` and `maxClients`.** A slow SSE client is not disconnected for being slow — the transport writes are fire-and-forget with no backpressure, so a client that can't keep up may silently miss frames rather than seeing an explicit disconnect or error.
- **`503 {"error":{"message":"HTTP transport is shutting down"}}` can come back from any route**, checked before auth and before routing, while the daemon is closing the transport down. Treat it like any other transient `503` and retry with backoff — it's not specific to `/events`' own `503` for `maxClients`, which carries a different message (`"Too many SSE clients"`).
- **`400 {"error":{"message":"Invalid request target: <redacted path>"}}` can come back from any route** if the request line itself doesn't parse as a URL. The query string is always stripped from the echoed path here (replaced with `?<redacted>`), because `GET /events` accepts a token in the query string and this is the one place a raw request target gets echoed back.
