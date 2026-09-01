---
title: "Vendor Client"
---
A connected exhibition gives each visitor a **Credential** — an RFID wristband, typically — and each **Station** a reader. A visitor taps, a vendor system turns that Credential into a **Visitor** and a **Profile**, and the Station app renders something personal.

`VendorClient` is the seam between launchpad and that vendor system. Launchpad ships the contract and a fake; the adapter that speaks your vendor's actual protocol lives in your project repo until a second project needs it.

```bash
npm install @bluecadet/launchpad-session
```

## The contract

```typescript
import type { VendorClient } from '@bluecadet/launchpad-session';

type VendorClient = {
  readonly name: string;
  resolveCredential(credential: string, options?: VendorCallOptions): ResultAsync<VisitorId | null, Error>;
  fetchProfile(visitorId: VisitorId, options?: VendorCallOptions): ResultAsync<Profile, Error>;
  subscribeTaps(handler: TapHandler): Unsubscribe;
  disconnect?(): ResultAsync<void, Error>;
};
```

| Member | Contract |
|---|---|
| `name` | Unique name for this adapter. Appears in state tracking and event payloads. |
| `resolveCredential` | Turns a tapped Credential into the Visitor behind it. `ok(null)` means the vendor answered but does not recognize the Credential. |
| `fetchProfile` | Retrieves vendor-owned Profile data for a Visitor. |
| `subscribeTaps` | Registers a handler for Credential taps. Returns its unsubscribe function. |
| `disconnect` | Optional cleanup on shutdown. |

It is a duck-type, not a base class: write a plain object that satisfies the type. Three properties are load-bearing.

**No configuration surface.** Endpoints, credentials, retry policy, and polling cadence belong to your adapter, never to the type. Take them as arguments to your own factory function, the way [`createLokiTransport`](../observability/transports/loki.md) does.

**Tap ingest is push-shaped, one way only.** `subscribeTaps` makes no claim about how you obtain taps. If your vendor pushes, wire the handler to its subscription. If your vendor only offers a "taps since last check" endpoint, own a timer and call the same handler. Cadence, jitter, and backoff never reach this interface.

**No presence query.** Nothing asks who is at the Station right now. Sessions do not survive a daemon restart and are not rehydrated — the visitor re-taps.

### Errors versus non-answers

The two channels mean different things, and the distinction drives degraded mode:

| Outcome | Meaning | What the broker does |
|---|---|---|
| `ok(visitorId)` | Vendor recognized the Credential | Opens a Session |
| `ok(null)` | Vendor answered; Credential is not one of its own | Opens no Session |
| `err(...)` | Vendor link is broken | Opens a degraded Session, or leaves the existing one degraded |

> [!NOTE]
> An unrecognized Credential is an ordinary outcome, not a failure. Reserve the error channel for a broken link so degraded mode stays a signal about your vendor connection rather than about a stray wristband from the museum next door.

### Tap-channel health is not observable

Nothing in this contract reports on the health of `subscribeTaps` itself. If a push adapter's socket drops, or a poll adapter's requests start failing, taps simply stop arriving — and a channel that has died is indistinguishable from a Station nobody is standing at.

This is deliberate, for the same reason there is no presence query: we cannot confirm that any given vendor exposes channel health, and inventing a member for it would bet on the unknown that `subscribeTaps` exists to absorb.

> [!IMPORTANT]
> `degraded` means "a lookup failed", never "taps stopped arriving". Do not read tap-channel health out of it, and do not treat a quiet channel as a healthy one.

Health belongs to the adapter, which is the only layer that knows what healthy looks like for its own transport — a socket close event, a run of consecutive poll failures, a heartbeat the vendor happens to offer. An adapter that can detect its own channel dying should surface that on its own type, above and beyond `VendorClient`, or report it out of band through logging. It will not travel through this contract.

### Cancellation

Both lookups take an options bag with an optional `AbortSignal`:

```typescript
const controller = new AbortController();
const result = await vendor.fetchProfile(visitorId, { signal: controller.signal });
```

Latency is unknown, so callers treat every call as arbitrarily slow. An adapter that receives a signal must settle promptly once it fires, rather than running the request to completion. The options bag exists so later options are additive.

## Writing an adapter

A push-based adapter is a wire-up over whatever your vendor's SDK emits:

```typescript
import { okAsync } from 'neverthrow';
import { sealProfile, toVisitorId, type VendorClient } from '@bluecadet/launchpad-session';

export function myVendor(sdk: VendorSdk): VendorClient {
  return {
    name: 'my-vendor',

    resolveCredential(credential, options) {
      return ResultAsync.fromPromise(sdk.lookup(credential, options), ensureError)
        .map((row) => (row ? toVisitorId(row.id) : null));
    },

    fetchProfile(visitorId, options) {
      return ResultAsync.fromPromise(sdk.profile(visitorId, options), ensureError)
        .map((row) => sealProfile({ data: row, language: row.locale }));
    },

    subscribeTaps(handler) { // [!code highlight]
      const listener = (event: SdkTapEvent) => // [!code highlight]
        handler({ credential: event.uid, observedAt: new Date(event.ts) }); // [!code highlight]
      sdk.on('tap', listener); // [!code highlight]
      return () => sdk.off('tap', listener); // [!code highlight]
    }, // [!code highlight]
  };
}
```

A poll-based adapter satisfies the same type with the same members — the timer is entirely its own business:

```typescript
    subscribeTaps(handler) { // [!code highlight]
      const timer = setInterval(async () => { // [!code highlight]
        for (const row of await sdk.tapsSince(lastCheck)) { // [!code highlight]
          handler({ credential: row.uid, observedAt: new Date(row.ts) }); // [!code highlight]
        } // [!code highlight]
      }, 250); // [!code highlight]
      return () => clearInterval(timer); // [!code highlight]
    }, // [!code highlight]
```

## The Profile is sealed

A Profile is vendor-owned data about a person. Launchpad forwards it to the Station app and keeps it nowhere else: never in the state store, never in an event payload, never in a log line.

The type enforces that rather than trusting a comment. `sealProfile()` hands back an opaque handle whose only readable field is `language` — the one value launchpad canonicalizes. Everything else needs an explicit `unsealProfile()` call, so a passthrough is always deliberate and always greppable.

```typescript
const profile = sealProfile({ data: vendorRow, language: vendorRow.locale });

profile.language;            // "es"
JSON.stringify(profile);     // "[Profile redacted]"
`${profile}`;                // "[Profile redacted]"
console.log(profile);        // [Profile redacted]

unsealProfile(profile);      // { displayName: "…", … } — forward it, do not store it
```

> [!WARNING]
> Redaction is a guardrail, not a permission slip. Once you call `unsealProfile()` you are holding personal data: hand it to the Station app and let it go.

## The thin canon

Only five fields describe a Session anywhere launchpad can persist or broadcast them:

```typescript
type Session = {
  readonly sessionId: SessionId;
  readonly visitorId: VisitorId;
  readonly language: string;
  readonly degraded: boolean;
  readonly seq: number;
};
```

| Field | Owner | Notes |
|---|---|---|
| `sessionId` | launchpad | Minted per Session. The only id observability ever sees. |
| `visitorId` | vendor | From `resolveCredential`. Opaque; never parsed. |
| `language` | vendor | From the Profile's `language`, with a configured fallback. |
| `degraded` | launchpad | True when the Session was built without a usable Profile. |
| `seq` | launchpad | Monotonic revision; clients that spot a gap re-query state. |

`sessionId` and `visitorId` are both opaque strings, and putting one where the other belongs is a real bug — a `visitorId` in a `sessionId` slot leaks vendor-resolved identity into state and logs. Both are branded, so the compiler catches the swap. Use `toVisitorId()` and `toSessionId()` at the edges where a plain string arrives, and `newSessionId()` to mint one.

## Driving the fake

`fakeVendor()` is the only implementation of `VendorClient` that ships with launchpad. It is the CI backbone and the demo backbone both: an entire Station app can be exercised with no network, no vendor account, and no hardware.

```typescript
import { fakeVendor } from '@bluecadet/launchpad-session';

const vendor = fakeVendor({
  visitors: {
    'wristband-1': {
      visitorId: 'v-ada',
      language: 'es',
      profile: { displayName: 'Ada Lovelace', membership: 'patron' },
    },
  },
});

vendor.tap('wristband-1'); // every subscriber sees the tap, synchronously
```

### Options

| Option | Type | Default | Purpose |
|---|---|---|---|
| `name` | `string` | `"fake"` | Reported as `VendorClient.name`. |
| `visitors` | `Record<string, { visitorId, language?, profile? }>` | `{}` | Credential directory. Listed Credentials resolve to exactly these values. |
| `unlistedCredentials` | `"derive" \| "unresolved"` | `"derive"` | Whether an unlisted Credential gets an invented Visitor or `ok(null)`. |
| `seed` | `number` | `0` | Seeds derived Visitors and Profiles. |
| `languages` | `string[]` | `["en","es","fr","de","ja"]` | Pool derived Profiles draw from. |
| `latencyMs` | `{ resolveCredential?, fetchProfile? }` | `0` each | Simulated round-trip time per call. |
| `faults` | `Fault[]` | `[]` | Failures active from creation. |

Use the `visitors` directory whenever a test asserts concrete values. Leave it empty and a demo still works: an unlisted Credential is hashed into a stable Visitor id, language, and Profile, so the same wristband produces the same visitor on every run and on every machine. Change `seed` to get a different — but equally reproducible — cast.

```typescript
const vendor = fakeVendor({ seed: 7 });
await vendor.resolveCredential('anything'); // ok("visitor-3f2a91c4"), every time
```

Set `unlistedCredentials: 'unresolved'` to model a closed directory, where a wristband from another institution answers `ok(null)`.

### Scripting

| Method | Purpose |
|---|---|
| `tap(credential, { observedAt? })` | Delivers one tap to every subscriber, synchronously. Returns the tap. |
| `tapSequence(credentials, { intervalMs? })` | Plays a run of taps. Synchronous at the default interval of `0`; pace a demo by raising it. |
| `injectFault({ call, message?, times? })` | Starts failing `resolveCredential` or `fetchProfile`. |
| `clearFaults()` | Stops all injected failures. |
| `calls` | Every call made so far, oldest first. |
| `subscriberCount` | How many tap handlers are attached. |

Faults are how you script degraded mode and recovery. Give `times` a number and the fake recovers on its own after that many calls; omit it and it fails until you clear it.

```typescript
vendor.injectFault({ call: 'fetchProfile', times: 1 });
vendor.tap('wristband-1'); // one degraded Session

vendor.tap('wristband-1'); // and the next tap recovers
```

Latency and cancellation are honored for real. A call with `latencyMs` set stays open for that long, and an aborted call settles immediately instead of waiting the delay out — so a test for cancellation actually tests something.

```typescript
const vendor = fakeVendor({ latencyMs: { fetchProfile: 10_000 } });
const controller = new AbortController();

const pending = vendor.fetchProfile(visitorId, { signal: controller.signal });
controller.abort();
await pending; // err, immediately
```

> [!TIP]
> `fakeVendor()` returns a `VendorClient` with the scripting methods added, so the same object goes to the session broker and to the code driving it. A demo script needs nothing else.
