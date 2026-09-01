# @bluecadet/launchpad-client

Typed client SDK for a launchpad Node's HTTP/SSE surface. Dispatch commands, subscribe to
events, mirror state, and follow the current visitor Session — from a browser kiosk app, a
docent tablet, or another Node process.

## Documentation

For complete documentation, examples, and API reference, visit:
<https://bluecadet.github.io/launchpad/reference/client>

## Features

- `executeCommand`, `getStatus`, and `getState` over `POST /command`, `GET /status`, `GET /state`
- Typed events through the declaration-merged `LaunchpadEvents` map, so plugin packages contribute their own payload types
- One shared SSE connection with reconnect, backoff, and sequence-gap detection
- `subscribeStatePatches`: a local mirror of `GET /state`, kept current with Immer patches and rebuilt whenever it may have gone stale
- `onSession`: the current Session and Profile, with push/poll reconciliation hidden
- Bearer-token auth, an injectable `fetch`, and `AbortSignal` teardown
- Every fallible call returns a neverthrow `Result`; nothing throws but programmer errors

## Installation

```bash
npm install @bluecadet/launchpad-client
```

## Basic Usage

```typescript
import { createClient } from '@bluecadet/launchpad-client';

const client = createClient({
  baseUrl: 'http://127.0.0.1:8710',
  token: import.meta.env.VITE_LAUNCHPAD_TOKEN,
});

client.onSession((view) => {
  render(view.session ? { language: view.session.language, profile: view.profile } : idleScreen);
});

const result = await client.executeCommand('workflow.run', { name: 'tour-mode' });
if (result.isErr()) {
  console.error(result.error.reason, result.error.message);
}
```

The Node this talks to must be running the controller's `httpTransport`, with the commands
you dispatch in its `allowedCommands` list. See
[Transports](https://bluecadet.github.io/launchpad/reference/controller/transports) and the
[Wire contract](https://bluecadet.github.io/launchpad/reference/controller/wire-contract).
