# @bluecadet/launchpad-session

Visitor session primitives for connected exhibitions: the `VendorClient` adapter contract a visitor-identity vendor is wired up through, and `fakeVendor()` for driving it with no vendor, no network, and no hardware.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad/reference/session/vendor-client>

## Features

- `VendorClient` duck-type: resolve a Credential, fetch a Profile, subscribe to taps
- Push-based and poll-based adapters satisfy the same four members
- `fakeVendor()` with scriptable taps, deterministic Visitors, and injectable latency and failures
- Branded `SessionId` and `VisitorId`, so the two opaque strings cannot be swapped
- Sealed Profiles that redact themselves under serialization, logging, and inspection

## Installation

```bash
npm install @bluecadet/launchpad-session
```

## Basic Usage

```typescript
import { fakeVendor, unsealProfile } from '@bluecadet/launchpad-session';

// Stand-ins for whatever your Station app does with a Session.
const app = {
  open: (language: string, profile: Record<string, unknown>) => { /* … */ },
  degrade: () => { /* fall back to a generic experience */ },
};

const vendor = fakeVendor({
  visitors: {
    'wristband-1': { visitorId: 'v-ada', language: 'es', profile: { displayName: 'Ada' } },
  },
});

async function openSession(credential: string): Promise<void> {
  const resolved = await vendor.resolveCredential(credential);
  if (resolved.isErr()) return app.degrade();  // vendor link is broken
  if (resolved.value === null) return;         // not one of our Credentials

  const profile = await vendor.fetchProfile(resolved.value);
  if (profile.isErr()) return app.degrade();

  app.open(profile.value.language ?? 'en', unsealProfile(profile.value));
}

// Tap handlers are called fire-and-forget and must not throw, so keep the handler
// synchronous and chain the async work onto a queue rather than returning a promise
// nobody awaits.
let pending = Promise.resolve();
vendor.subscribeTaps((tap) => {
  pending = pending.then(() => openSession(tap.credential));
});

vendor.tap('wristband-1');
await pending;
```

## License

ISC
