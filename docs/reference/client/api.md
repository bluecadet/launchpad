---
title: "Client API"
---
Everything `createClient` returns, what each method can fail with, and the two or three places a browser and Node differ. The protocol underneath is the [wire contract](../controller/wire-contract.md); this page is the TypeScript surface over it.

## `createClient(options)`

```typescript
import { createClient } from '@bluecadet/launchpad-client';

const client = createClient({ baseUrl: 'http://127.0.0.1:8710' });
```

| Option | Type | Default | Purpose |
|---|---|---|---|
| `baseUrl` | `string` | — | Required. Origin (plus any base path) of the Node's HTTP transport. Trailing slashes are stripped. |
| `token` | `string` | — | Bearer token, when the operator configured `auth.tokens`. Sent as an `Authorization` header on every route, including `/events`. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Substitute implementation. Must support streaming response bodies. |
| `reconnectDelayMs` | `number` | the server's `retry:` hint | Base delay before reopening a dropped event stream. Setting it ignores the server's hint. |
| `maxReconnectDelayMs` | `number` | `30000` | Ceiling for the backoff, which doubles per consecutive failure. |
| `onError` | `(error) => void` | — | Called for failures with no `Result` to return: a state refetch that failed, a dropped stream, a malformed frame. Recovery is automatic; this is for logging. |

`createClient` throws a `TypeError` if no `fetch` is available and none was passed. That is the only thing this package throws — every runtime failure arrives as a `Result` or through `onError`.

### Results, not exceptions

Every fallible call returns a [neverthrow](https://github.com/supermacro/neverthrow) `ResultAsync`, which is awaitable:

```typescript
const result = await client.getStatus();
if (result.isErr()) {
  console.error(result.error.reason);
  return;
}
console.log(result.value.header.node.id);
```

`result.match(onOk, onErr)` and `result.map(…)` work as usual; nothing in this package rejects a promise.

## Commands

```typescript
executeCommand<TResult = unknown>(
  type: CommandId,
  params?: Record<string, unknown>,
): ResultAsync<TResult, CommandError>
```

Dispatches `POST /command` and unwraps its `result`. `params` are merged into the request body alongside `type`. `CommandId` is the template type every command name satisfies — `` `${string}.${string}` `` — so a name with no dot in it is a type error before it is ever a `404`.

```typescript
const run = await client.executeCommand<WorkflowRun>('workflow.run', { name: 'tour-mode' });
```

`TResult` is an assertion, not a validation — the SDK does not check a command's result against a schema, because the shape belongs to the plugin that registered it. A command that resolves with nothing resolves `null` here, per [the `result` presence guarantee](../controller/wire-contract.md#the-result-presence-guarantee).

A `CommandError` carries `reason`, `status`, `commandType`, and `cause`. `commandType` is the **canonical** id of the command that failed, which differs from the `type` you sent when the Node resolved an alias.

## Reads

```typescript
getStatus(): ResultAsync<StatusSnapshot, ClientError>
getState(): ResultAsync<VersionedWireState, ClientError>
```

`getStatus` is also the liveness check: one round trip answers "is this Node up" and "which Node is it", via `header.node.id`.

`getState` fails with `reason: "state-not-exposed"` unless the operator set `exposeState: true`. What comes back is the wire shape, not the server's in-memory one — `system.startTime` is an ISO 8601 **string** here, and anything a `Date` is not degrades per [Serialization and lossiness](../controller/wire-contract.md#serialization-and-lossiness).

```typescript
type VersionedWireState = {
  system: { startTime: string; mode: 'persistent' | 'task'; node: NodeIdentity };
  plugins: Partial<PluginsState>;
  _version: number;
};
```

`plugins` is typed through the declaration-merged `PluginsState` interface: importing `@bluecadet/launchpad-session` in your app types `state.plugins.session`, and it stays `undefined`-able because the SDK cannot know which plugins a given Node runs.

## Errors

Two classes, both extending `Error`, both discriminated by `reason` — never by `message`. The contract reserves the right to reword every message and to add new `reason` values as a non-breaking change, so an exhaustive `switch` over these unions always needs a default arm.

```typescript
import { ClientError, CommandError } from '@bluecadet/launchpad-client';
```

`CommandError` is what `executeCommand` fails with; `ClientError` is what everything else fails with. `CommandError.reason` is the union of the three command-failure reasons below, the two pre-dispatch rejection reasons, and every `ClientError` reason, because a dispatch can also fail before it reaches a handler.

| `reason` | Status | Meaning |
|---|---|---|
| `not-registered` | `404` | The command cleared the allowlist but no plugin on this Node implements it. Retrying never helps. |
| `invalid` | `400` | The command exists; its own parameters failed its schema. `cause` is the serialized `ZodError`. |
| `handler-failed` | `500` | The handler ran and failed. `cause` is the plugin's own error. |
| `not-allowed` | `403` | The command is outside the transport's `allowedCommands`. Checked before the token's role, so it applies even to an anonymous caller. |
| `role-denied` | `403` | The token is valid, but its role's command globs don't cover this command. |
| `bad-request` | `400` | The request itself was malformed — no string `type`, or an unreadable body. |
| `unauthorized` | `401` | No token, or one this Node does not recognize. |
| `forbidden` | `403` | A `403` whose body carried no recognized `reason`. |
| `not-found` | `404` | No such route. Usually a wrong `baseUrl`. |
| `state-not-exposed` | `404` | `GET /state` only: the operator did not set `exposeState`. |
| `too-large` | `413` | The request body exceeded the transport's 64KB limit. |
| `unavailable` | `503` | The Node is shutting down, or `/events` is at `maxClients`. |
| `server-error` | 5xx | Any other server failure. |
| `network` | — | `fetch` never got an answer: no route, DNS, TLS, CORS, or an abort. `status` is `null`. |
| `malformed-response` | any | The Node answered, but not with something this SDK could read: a 2xx whose body is not the shape the contract promises, an SSE frame whose payload is not JSON, a `200` on `/events` with no body to stream, a state patch frame missing its `patches` or `version`, or a patch that would not apply to the mirror. |
| `unknown` | any | A status code this SDK has no mapping for. |

The `400`s, `404`s, and `403`s are each told apart by the body, not the code: a failure this Node classified carries `error.reason`; one it didn't carries only `error.message`. The SDK does that disambiguation for you — it is listed here so a `reason` you see in a log makes sense.

```typescript
switch (error.reason) {
  case 'not-registered':
  case 'not-allowed': return showOperatorMisconfiguration();
  case 'unauthorized':
  case 'forbidden':
  case 'role-denied': return showTokenProblem();
  case 'network':
  case 'unavailable': return retryLater();
  default: return showGenericFailure(error.message);
}
```

## Events

```typescript
on<TName extends EventName>(
  event: TName,
  handler: (data: LaunchpadEvents[TName], frame: EventFrame) => void,
  options?: { signal?: AbortSignal },
): Unsubscribe

subscribeEvents(handler: (frame: EventFrame) => void, options?): Unsubscribe
```

`on` is the typed door. `EventName` is `keyof LaunchpadEvents`, the interface every launchpad package merges its own events into. Nothing is passed to `createClient` to enable this — a package is typed in once it is in your program's type graph:

```typescript
client.on('session:started', ({ session }) => {
  // `session` is a Session, not `unknown`.
  greet(session.language);
});
```

Session events are typed out of the box, because this package depends on `@bluecadet/launchpad-session` and pulls its declarations along. Any other plugin's events need that plugin installed and imported by your app:

```typescript
import type { ContentEvents } from '@bluecadet/launchpad-content';

// The import above is what types this handler; without it the name is not
// on the map at all and `on` rejects it.
client.on('content:version:promoted', ({ versionId }) => reload(versionId));

type PromotedPayload = ContentEvents['content:version:promoted'];
```

An event name the merged map does not know is a type error on `on`. Reach for `subscribeEvents` for anything genuinely dynamic.

`subscribeEvents` is the untyped door — every frame, including event names this SDK has no types for, with `data` as `unknown`. Both hand you the raw frame:

```typescript
type EventFrame = {
  event: string;
  data: unknown;
  /** The frame's sequence number. Absent on a replayed frame. */
  seq?: number;
  /** True for a frame served from the replay backlog rather than broadcast live. */
  replayed: boolean;
};
```

`replayed` is the distinction a browser `EventSource` [structurally cannot make](../controller/wire-contract.md#replay-on-connect), and it is the reason this package streams over `fetch` instead. A replayed frame is a snapshot of state as of some earlier moment, not something that just happened — do not count it, animate it, or treat it as a transition.

An event only arrives if the operator's `events` filter forwards it. The default filter is `["content:*"]`, so an app that wants `session:*` needs the operator to say so.

## Connection state

```typescript
onConnection(handler: (event: ConnectionEvent) => void, options?): Unsubscribe

type ConnectionEvent =
  | { type: 'connected' }
  | { type: 'reconnected' }
  | { type: 'gap'; expected: number; received: number }
  | { type: 'disconnected'; error?: ClientError; terminal?: boolean };
```

One SSE connection is shared by every subscription on a client; it opens with the first subscriber and closes with the last. `connected` fires once per client, on the first successful open — a listener registered later will not see it. Every open after that reports `reconnected`, including the one that follows the last subscriber leaving and a new one arriving, because by the contract's rules [every reconnect is a gap](../controller/wire-contract.md#sequence-numbers-and-reconnection).

A `disconnected` event carries the `ClientError` that ended the connection, when there was one. The SDK normally reopens on its own with exponential backoff, but three rejections mean the Node will never accept this client as configured — `unauthorized`, `forbidden`, and `not-found` — and retrying them would fill an unattended Station's logs with a failure only an operator can clear. So the SDK stops, and the last event it emits is marked:

```typescript
client.onConnection((event) => {
  if (event.type === 'disconnected' && event.terminal) {
    // A revoked token, a role that does not cover /events, or a wrong baseUrl.
    return showOperatorProblem(event.error?.reason);
  }
});
```

Nothing reconnects after that until a new subscription opens a fresh connection. Everything else — a `503` at `maxClients`, a `5xx`, a dropped socket, a Node that is restarting — keeps retrying.

`reconnected` and `gap` mean the same thing to an app: whatever you built from this stream may be stale, so re-read the authoritative source. Use the exported helper rather than listing them by hand:

```typescript
import { isResyncSignal } from '@bluecadet/launchpad-client';

client.onConnection((event) => {
  if (isResyncSignal(event)) refetchMyOwnDerivedView();
});
```

`subscribeStatePatches` and `onSession` already do this for what they own; `onConnection` is for anything an app derived from the stream itself.

## State mirroring

```typescript
subscribeStatePatches(handler: (state: VersionedWireState) => void, options?): Unsubscribe
```

Calls `handler` with a full state tree: once with the baseline read, again on every change, and again from scratch whenever the mirror may have gone stale. It never hands you a patch — an app renders from whole state.

Push here is sugar over an authoritative read, never a replacement. A patch applies only when its `version` is exactly one past the mirror's; a version gap, a sequence gap, a reconnect, or a patch that will not apply all fall back to re-fetching `GET /state`.

That is why this needs **both** transport options:

```typescript
httpTransport({ exposeState: true, pushStatePatches: true });
```

Without `exposeState` the baseline read fails through `onError` and nothing is ever emitted. Without `pushStatePatches` the handler is called once with the baseline and never updates.

## Sessions

```typescript
onSession(handler: (view: SessionView) => void, options?): Unsubscribe
```

Covered on its own page — see [Sessions](./session.md).

## Teardown

Every `subscribe*` / `on*` method returns an `Unsubscribe`, and every one of them accepts `{ signal }`; aborting the signal does exactly what calling the returned function does.

```typescript
const controller = new AbortController();
client.on('session:current', render, { signal: controller.signal });
controller.abort();

client.close(); // drops every subscription and closes the stream
```

Dropping the last subscriber closes the SSE connection on its own — `close()` is for tearing the whole client down.

## Browser and Node

The same build runs in both. What it needs is `fetch` with streaming response bodies (`response.body` as a `ReadableStream`): Node 23+, or any current browser.

**The event stream is `fetch`, not `EventSource`.** Three consequences worth knowing:

- **The token goes in the `Authorization` header**, on `/events` as on every other route. The `?access_token=` query parameter the transport also accepts on `/events` exists for `EventSource` clients that cannot set headers; this SDK never sends it, so a token never reaches a proxy's access log.
- **Reconnection is this package's job**, not the browser's, which is what makes "every reconnect is a gap" implementable — see [Sequence numbers and reconnection](../controller/wire-contract.md#sequence-numbers-and-reconnection).
- **Replayed frames are distinguishable** from live ones, via `frame.replayed`.

In a browser, the transport's `allowedOrigins` has to cover the page's origin or the browser blocks the app from reading any response — including error bodies, which is why a misconfigured origin surfaces as `reason: "network"` rather than something more specific. CORS never blocks the request server-side; see [CORS headers on every response](../controller/wire-contract.md#cors-headers-on-every-response).

In Node, `globalThis.fetch` is used as-is. The `fetch` option exists for a proxy, a test double, or a runtime whose global needs wrapping.
