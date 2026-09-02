---
title: "Sessions"
---
`onSession` is the whole client side of a tap-to-render Station app: one callback, called with everything there is to know about who is standing at this Station right now.

```typescript
client.onSession((view) => {
  if (view.session === null) return renderAttractLoop();
  renderVisitor({ language: view.session.language, profile: view.profile });
});
```

What it hides is the reconciliation. The broker's events carry [the thin canon and nothing else](../session/session-plugin.md#the-profile-is-not-on-any-event) — the vendor Profile only ever crosses the wire in a `session.current` result — so an app following the raw stream has to know when an event is enough and when it has to go ask. This does that.

## What the view holds

```typescript
type SessionView = {
  /** The Session at this Station, or null when nobody is here. */
  session: Session | null;
  /** Vendor-owned Profile for that Session. null when the Station is idle. */
  profile: ProfileData | null;
  /** True while launchpad's link to the vendor is failing. */
  degraded: boolean;
};
```

`Session` and `ProfileData` are the session package's own types, imported from `@bluecadet/launchpad-session` — the SDK re-uses them rather than restating them, so a field added there is typed here without a client release.

The two `degraded` flags answer different questions, exactly as they do [server-side](../session/session-plugin.md#degraded-mode). `view.session.degraded` is a snapshot taken when that Session's canon was last written: render fallback content off it. `view.degraded` is the vendor link as of the last thing the client heard: put an operator-facing indicator on it. They legitimately disagree after a recovery, until the visitor taps again.

That is why a `session:degraded` frame outranks the canon once one has arrived. `view.degraded` starts from the current Session's own snapshot, but from the first transition onwards it tracks the transitions — so a `session.current` answer after a reconnect cannot resurrect an outage the client already watched clear.

## When the handler is called

- **On subscribe**, with the authoritative answer from `session.current`.
- **On every canon change** the stream reports.
- **After every reconnect or sequence gap**, with a freshly queried answer.
- **Again, moments after a Session starts**, once its Profile has arrived.

That last one is worth designing around: a new Session is emitted the instant the canon changes, with `profile: null`, and again with the Profile once the follow-up `session.current` answers. An app that renders the Profile should treat `profile: null` on a live Session as "not here yet", not as "this visitor has none".

## What re-queries, and what applies locally

`session.current` is the authoritative query. The SDK calls it:

- on subscribe,
- on every reconnect and every detected sequence gap, per [the reconnection rules](../controller/wire-contract.md#sequence-numbers-and-reconnection),
- after any canon change that produces a Session it holds no Profile for — which is every `session:started`.

Everything else is applied locally, with no round trip:

| Event | What the view does |
|---|---|
| `session:started` | Adopts the canon immediately, then re-queries for the Profile. |
| `session:ended` | Goes idle, if the ended Session is the one the view is holding. |
| `session:current` | Adopts the canon, or goes idle when it carries `null`. |
| `session:degraded` | Flips `view.degraded`. Nothing else changes. |

Two frames are ignored on purpose. A **replayed** frame — one served from the transport's backlog on connect, carrying no `id:` — is a stale snapshot, and the subscribe-time query already covers that ground. And a **stale revision** is dropped: `seq` is a revision counter for one Session, not a global one, so it is only compared within the same `sessionId`.

What "stale" means depends on the frame. For `session:started` and `session:current`, which carry a revision of the canon, a `seq` that is not **greater** than the one the view holds for that `sessionId` is discarded; a frame for a *different* `sessionId` always wins, because last tap wins. For `session:ended` the rule is looser in one direction and stricter in the other: the frame has to name the Session the view is holding, and its `seq` has to be at least the revision being held — the broker ends a Session without bumping its `seq`, so an end normally carries the revision the view already has. An end for a Session the view is not holding, or for a revision older than the one it holds, changes nothing, and neither does one that arrives when the Station is already idle.

A query answer can be stale too. If an event moves the canon while a `session.current` call is in flight, its answer is discarded when it lands rather than resurrecting the Session it was about — and a fresh query goes out in its place, because the discarded answer was the only thing carrying a Profile. The view never sits on an event it could not fill in.

## Failure and restart

**A failed query leaves the last view standing.** The error goes to `onError`; the handler is not called with an idle view. An app is better off holding its screen through a blip than blanking the visitor's content because one request timed out.

That is also what makes a daemon restart behave the way the broker's own [restart doctrine](../session/session-plugin.md#designed-behavior-on-restart) describes:

1. The daemon dies. The app keeps rendering its last view; the SDK backs off and retries the stream.
2. The daemon comes back. The stream reconnects, which is a resync signal, so the SDK re-queries `session.current`.
3. Sessions do not survive a restart, so that query answers `{ session: null, profile: null }`, and only **then** does the view go idle.

So the app forgets the visitor when the Node says the visitor is gone — never on a disconnect alone. The visitor taps again and a new `sessionId` opens; the old one never returns.

## What the Node has to be running

`onSession` needs the [session plugin](../session/session-plugin.md) on the Node, and the transport configured to let both halves through:

```typescript
httpTransport({
  events: ['session:*'],
  allowedCommands: ['session.current'],
  replayEvents: ['session:current'],
});
```

`allowedCommands` is the one that fails loudly: without `session.current` on it, every query fails with `reason: "not-allowed"` and the view never leaves idle. Without `events: ['session:*']` nothing fails — the view is simply only ever as current as its last query, which after subscribe means it never updates again.

`replayEvents` is optional for this SDK, since it queries on connect rather than waiting for a frame. Add it anyway if anything else on the Node subscribes to `session:current` directly.

## A worked Station app

```typescript
import { createClient } from '@bluecadet/launchpad-client';

const client = createClient({
  baseUrl: 'http://127.0.0.1:8710',
  token: import.meta.env.VITE_LAUNCHPAD_TOKEN,
  onError: (error) => console.warn('launchpad', error.reason, error.message),
});

client.onSession(({ session, profile, degraded }) => {
  document.body.dataset.vendorLink = degraded ? 'degraded' : 'ok';

  if (session === null) {
    return renderAttractLoop();
  }
  renderVisitor({
    language: session.language,
    // Null while the follow-up query is in flight, and for a Session opened
    // during a vendor outage.
    profile,
    fallback: session.degraded,
  });
});

// Ending a Session from the app itself — a "done" button on the kiosk.
document.querySelector('#done')?.addEventListener('click', async () => {
  const result = await client.executeCommand('session.end');
  if (result.isErr()) console.warn(result.error.reason);
});
```

`session.end` needs its own `allowedCommands` entry. `session.tap.simulate` is the one to keep **out** of a production allowlist — it lets anyone who can reach the transport impersonate a wristband.
