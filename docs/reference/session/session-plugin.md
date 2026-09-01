---
title: "Session Plugin"
---
The session broker owns this Node's link to the visitor-identity vendor and holds the one Session its Station currently has. A visitor taps a Credential, the broker resolves it, and the Station app reads the result over the controller's existing command and SSE surface — it never talks to the vendor itself.

That division is the whole point: vendor auth, retry, Profile caching, and degraded-mode fallback are written once here instead of once per exhibit app.

```bash
npm install @bluecadet/launchpad-session
```

```typescript
import { session, fakeVendor } from '@bluecadet/launchpad-session';

export default defineConfig({
  plugins: [
    session({
      vendor: fakeVendor({
        visitors: {
          'wristband-1': { visitorId: 'v-ada', language: 'es', profile: { displayName: 'Ada' } },
        },
      }),
      idleTimeoutMs: 90_000,
    }),
  ],
});
```

`fakeVendor()` is a real, shipped implementation, not a test double you have to replace before commissioning — see [Vendor Client](vendor-client.md). Swapping it for your project's adapter changes nothing else in this page.

## Configuration

| Option | Type | Default | Purpose |
|---|---|---|---|
| `vendor` | `VendorClient` | — | Required. The adapter this Station's Sessions are built from. |
| `idleTimeoutMs` | `number` | `60000` | Milliseconds of quiet before the current Session times out. Positive integer. |
| `fallbackLanguage` | `string` | `"en"` | BCP-47 tag used when the vendor is unreachable, or its Profile declares no language. |

There is nothing here about endpoints, vendor credentials, retry policy, or polling cadence. Those belong to your adapter's own factory function and never enter launchpad config or state — see [the no-configuration-surface rule](vendor-client.md#the-contract).

## The state machine

One Node runs one Station, so the broker is in exactly one of two states: **idle**, or **active** with a single Session. `degraded` is an orthogonal flag describing the vendor link, not the Session.

| Current state | Input | Next state | Events emitted |
|---|---|---|---|
| idle | tap resolves to a Visitor | active | `session:started`, `session:current` |
| idle | tap the vendor doesn't recognize | idle | — |
| idle | `session.end` | idle | — |
| active | tap with the **same** Credential | active (refreshed, new `seq`) | `session:current` |
| active | tap with a **different** Credential | active (new Session) | `session:ended` (`replaced`), `session:started`, `session:current` |
| active | `idleTimeoutMs` elapses with no tap | idle | `session:ended` (`timeout`), `session:current` |
| active | `session.end` | idle | `session:ended` (`explicit`), `session:current` |
| either | `resolveCredential` errors | unchanged — the tap is dropped | `session:degraded` (`true`), on the first failure |
| either | `fetchProfile` errors | as the matching tap row above, `degraded: true` | `session:degraded` (`true`) on the first failure, then that row's events |
| either | a lookup succeeds again | unchanged | `session:degraded` (`false`) |

Last tap wins. A re-tap of the Credential already at the Station keeps the same `sessionId` and pushes the idle deadline out; it does not end and restart the Session, so an app that keys its render off `sessionId` sees no flicker when a visitor taps twice.

### Concurrent taps

Taps are never serialized. A visitor can tap while the previous visitor's lookup is still in flight, and the broker will not make the second wait on the first. Ordering is decided by **when a tap arrived**, not by when its vendor lookup finished: a lookup that lands after a later tap has already been applied is discarded, so a slow answer for a Credential that has since been replaced cannot resurrect it.

The observable consequence: a tap can produce no events at all, if a later tap beat it to the Station.

## Degraded mode

`degraded` means a vendor lookup failed. It never means taps stopped arriving — nothing in the `VendorClient` contract reports tap-channel health, [by design](vendor-client.md#tap-channel-health-is-not-observable).

| What failed | What the broker does |
|---|---|
| `resolveCredential` errors | Sets `degraded`, drops the tap. There is no Visitor to fall back to — the Profile cache is keyed by Visitor, and resolving the Credential is exactly what failed. |
| `fetchProfile` errors, Visitor **is** in the Profile cache | Sets `degraded`, opens or refreshes the Session with the cached Profile's language, `degraded: true`. `session.current` still returns the cached Profile. |
| `fetchProfile` errors, Visitor is **not** cached | Sets `degraded`, opens or refreshes the Session on `fallbackLanguage`, `degraded: true`, no Profile. |
| Any lookup succeeds again | Clears `degraded`, emits `session:degraded` with `degraded: false`. |

`session:degraded` fires on transitions only, so a Station with a dead vendor emits one event, not one per tap.

The Profile cache is an in-memory `Map` of the last Profile seen per Visitor. It is dropped on shutdown, and there is no on-disk tier: a daemon that restarts during a vendor outage has an empty cache and serves `fallbackLanguage` until the vendor returns.

> [!IMPORTANT]
> `state.plugins.session.degraded` and `state.plugins.session.current.degraded` answer different questions and can legitimately disagree. The first is the vendor link **right now**. The second is a snapshot of that flag taken when the Session's canon was last written — a Session opened during an outage stays `degraded: true` until the visitor taps again, even after the link recovers. Render off the Session's flag; alert off the state slice's.

## Commands

All three are registered on the plugin manifest and reachable over `POST /command` once the operator lists them in the transport's `allowedCommands` — see [Dispatching a command](../controller/wire-contract.md#dispatching-a-command).

### `session.current`

```typescript
// request
{ type: 'session.current' }

// result
{
  session: {
    sessionId: '4f1c…',
    visitorId: 'v-ada',
    language: 'es',
    degraded: false,
    seq: 3,
  } | null,
  profile: { displayName: 'Ada Lovelace', membership: 'patron' } | null,
}
```

The authoritative query. Push is best-effort sugar over this: a client that spots a sequence gap, or has just restarted, asks here rather than replaying event history.

`profile` is the vendor's own object, passed straight through from memory, and is the **only** place it crosses the wire. Both fields are `null` when the Station is idle.

### `session.end`

```typescript
// request
{ type: 'session.end' }

// result
{ ended: true, sessionId: '4f1c…' }
```

Ends the current Session with reason `explicit`. Ending an idle Station is an ordinary success, not an error: it answers `{ ended: false, sessionId: null }` and emits nothing.

### `session.tap.simulate`

```typescript
// request
{ type: 'session.tap.simulate', credential: 'wristband-1' }

// result
{ accepted: true, session: { /* thin canon */ } | null }
```

Feeds a Credential through the exact path a real tap takes — same vendor lookups, same state machine, same events — and resolves once the tap has been serviced. `accepted` is `false` when nothing changed, which is what an unrecognized Credential produces.

> [!WARNING]
> This command is always registered, and it lets anyone who can reach the transport impersonate a wristband. Exclude it in production by not listing it in the transport's `allowedCommands`, or by scoping the token role that reaches the Node — see [Authentication](../controller/wire-contract.md#authentication). Note also that its `credential` argument appears on the `command:start` event, which is one more reason to keep it out of production allowlists.

## Events

Every payload carries the thin canon and nothing else.

| Event | Payload |
|---|---|
| `session:started` | `{ session: Session }` |
| `session:ended` | `{ session: Session, reason: 'replaced' \| 'timeout' \| 'explicit' }` |
| `session:current` | `{ session: Session \| null }` |
| `session:degraded` | `{ degraded: boolean }` |

`Session` is the five-field canon documented under [The thin canon](vendor-client.md#the-thin-canon). `seq` is monotonic for the broker's lifetime and advances on every canon change, including a same-Credential refresh.

### `session:current` needs to be in `replayEvents`

`session:current` fires on **every** canon change, which makes it the event a reconnecting client rehydrates from. That only works if the transport is told to remember it:

```typescript
httpTransport({
  events: ['session:*'],
  replayEvents: ['session:current'],
  allowedCommands: ['session.current', 'session.end'],
});
```

`replayEvents` is a transport option, not something a plugin can set for you, and the default list does not include `session:current`. Without it, an app that starts up mid-Session learns nothing until the next tap. With it, the app receives the last `session:current` frame the moment it connects. The mechanics — one frame per event name, no `id:` on replayed frames — are in [Replay on connect](../controller/wire-contract.md#replay-on-connect).

### The Profile is not on any event

Session events carry no Profile. This is not an oversight, and there is a concrete reason it cannot be otherwise: event payloads and command results share one serializer, and events fan out to *every* authenticated SSE client plus any observability sink watching them. A Profile on `session:started` would be broadcast vendor-owned data about a person.

So the hand-off is: **events tell you the Session changed; `session.current` gives you the Profile.** An app calls `session.current` after `session:started` (or after any `session:current` whose `sessionId` it hasn't seen) and gets the canon and the Profile together, in one authoritative answer.

> [!CAUTION]
> The controller emits `command:success` with the command's result verbatim, so a `session.current` call puts the Profile on that event. Both places that could observe it are opt-in and default to off — keep `command:*` out of the transport's `events` filter, and out of `observability`'s `include` patterns (or name it in `exclude`), on any Node running this plugin.

Sealing backs this up mechanically rather than by convention: a `Profile` serializes to `[Profile redacted]` everywhere except where something deliberately called `unsealProfile()`. See [The Profile is sealed](vendor-client.md#the-profile-is-sealed).

## State

```typescript
state.plugins.session = {
  current: Session | null,
  degraded: boolean,
}
```

Thin canon only — no Profile ever reaches the state store, so `GET /state` and every state patch are free of vendor-owned data. `visitorId` is a vendor-opaque handle and `sessionId` is launchpad's own, which is what makes a state dump safe to paste into a ticket.

`launchpad status` shows a **Session** section with one row each for the Session id, the Visitor, the language, the vendor link, and `seq`.

## Designed behavior on restart

**A restarted daemon comes up idle, with no Session, even if a visitor is standing at the Station.** This is designed, not a defect, and commissioning teams should expect it.

Sessions live in memory and are never persisted. Nothing in the `VendorClient` contract asks the vendor "who is at this Station right now" — [no presence query exists](vendor-client.md#the-contract), because there is no reason to believe every vendor can answer it. So there is nothing to rehydrate from.

What actually happens in the field:

- The Station app keeps its last-received copy of the Session and can keep rendering.
- The daemon reports `session.current` as `null` and emits nothing until the next tap.
- The visitor taps again, and a **new** `sessionId` opens. The old one never returns.

An app crashing and restarting is the *other* case, and it does recover: the daemon still holds the Session, so the app rehydrates from the replayed `session:current` frame or a `session.current` call the moment it reconnects.

## Stated limitations

These are deliberate boundaries, documented rather than coded around.

- **Sessions do not survive a daemon restart.** See above.
- **One Station per Node.** A machine driving two visitor-facing interaction points runs a second daemon with a separate `baseDir`.
- **Session events are transport-global.** Every authenticated SSE client on the Node sees them; there is no per-client session scoping.
- **Cross-station exclusivity belongs to the vendor.** Launchpad will happily hold the same Visitor's Session at two Stations at once. Whether that is allowed is the vendor/museum layer's policy, never launchpad's.
- **The Profile cache is memory only.** No on-disk LRU tier.
- **Tap-channel health is not observable.** A dead tap channel is indistinguishable from a quiet Station, and `degraded` will not tell you the difference.
