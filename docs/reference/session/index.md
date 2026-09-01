---
title: "@bluecadet/launchpad-session"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/session) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-session) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/session/CHANGELOG.md)

The session package turns a visitor tapping an RFID wristband into something a Station app can render. A vendor system resolves the Credential into a Visitor and a Profile; launchpad's broker owns that vendor link for the Node, holds the Station's current Session, and serves it over the controller's existing command and SSE surface. Exhibit apps stop re-implementing vendor auth, retry, caching, and degraded mode once each.

## Features

- **Session broker plugin**: One Session per Station, last-tap-wins, configurable idle timeout
- **Commands and events**: `session.current` as the authoritative query, `session:*` events as push sugar over it
- **Degraded mode**: An in-memory Profile cache and a language fallback keep a Station usable through a vendor outage
- **`VendorClient` duck-type**: A four-member contract a push-based or poll-based adapter satisfies identically
- **`fakeVendor()`**: Scriptable taps, deterministic Visitors, and injectable latency and faults — a full tap-to-render demo with no vendor account, no network, and no hardware
- **PII boundary enforced by types**: Sealed Profiles that redact themselves under serialization, and branded `SessionId`/`VisitorId` that cannot be swapped

## Installation

```bash
npm install @bluecadet/launchpad-session
```

## JS API Usage

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
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

Swap `fakeVendor()` for your project's adapter when the real vendor arrives; nothing else changes.

## Where to go next

- [Session Plugin](./session-plugin.md) — configuration, commands, events, the state machine, degraded mode, and the designed restart behavior. Start here if you are writing a Station app or commissioning an exhibit.
- [Vendor Client](./vendor-client.md) — the adapter contract, the sealed Profile, the thin canon, and the fake's scripting surface. Start here if you are writing an adapter for a real vendor.

## Stated limitations

Sessions do not survive a daemon restart, one Node drives one Station, session events are transport-global, and cross-station exclusivity belongs to the vendor. Each is a deliberate boundary rather than a gap — see [Stated limitations](./session-plugin.md#stated-limitations).
