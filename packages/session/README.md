# @bluecadet/launchpad-session

Visitor sessions for connected exhibitions: the `session()` broker plugin that owns a Station's current Session, the `VendorClient` adapter contract a visitor-identity vendor is wired up through, and `fakeVendor()` for driving the whole path with no vendor, no network, and no hardware.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad/reference/session/session-plugin>

## Features

- `session()` plugin: last-tap-wins Session per Station, idle timeout, degraded mode
- `session.current`, `session.end`, and `session.tap.simulate` commands
- `session:started`, `session:ended`, `session:current`, and `session:degraded` events
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
import { defineConfig } from '@bluecadet/launchpad';
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

The Station app then reads the Session over the HTTP transport: `session.current` for the
authoritative answer, `session:current` over SSE for the push. Swap `fakeVendor()` for
your own `VendorClient` when the real vendor arrives — nothing else changes.

## License

ISC
