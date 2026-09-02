---
title: "@bluecadet/launchpad-client"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/client) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-client) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/client/CHANGELOG.md)

The client package is the typed SDK for a Node's HTTP/SSE surface. A kiosk app, a docent tablet, or another Node process installs it, points it at a `baseUrl`, and gets commands, events, a live mirror of state, and the current visitor Session — without writing reconnect loops, sequence-gap detection, or push/poll reconciliation by hand.

Everything it does is defined by the [wire contract](../controller/wire-contract.md), which stays the authority on the protocol itself. This package is one implementation of that contract, for TypeScript and JavaScript, in a browser or in Node.

## Features

- **Commands, status, and state**: `executeCommand`, `getStatus`, and `getState`, each returning a `Result` instead of throwing
- **Typed events**: `client.on('session:started', …)` types its payload from the declaration-merged `LaunchpadEvents` map, so a plugin package your app imports contributes its own event types
- **One shared SSE stream** with reconnect, exponential backoff, and sequence-gap detection, so the transport's `maxClients` cap sees one client per app
- **State mirroring**: `subscribeStatePatches` keeps a local copy of `GET /state` current from patch frames and rebuilds it from scratch whenever it may have gone stale
- **`onSession`**: one callback with the current Session, its Profile, and the vendor link's health, with the push/poll reconciliation hidden
- **Bearer tokens, an injectable `fetch`, and `AbortSignal` teardown**

## Installation

```bash
npm install @bluecadet/launchpad-client
```

## Usage

```typescript
import { createClient } from '@bluecadet/launchpad-client';

const client = createClient({
  baseUrl: 'http://127.0.0.1:8710',
  token: import.meta.env.VITE_LAUNCHPAD_TOKEN,
  onError: (error) => console.warn(error.reason, error.message),
});

client.onSession((view) => {
  render(view.session ? { language: view.session.language, profile: view.profile } : idleScreen);
});

const result = await client.executeCommand('workflow.run', { name: 'tour-mode' });
if (result.isErr()) {
  console.error(result.error.reason, result.error.message);
}
```

The Node on the other end has to be running the controller's [`httpTransport`](../controller/transports.md), with every command this app dispatches listed in its `allowedCommands` — the allowlist starts empty, so a fresh Node dispatches nothing until an operator opts in.

## Where to go next

- [API](./api.md) — `createClient` options, every method's signature, the error `reason` catalogue and the status codes it maps from, typed events, state mirroring, and the browser/Node differences. Start here.
- [Sessions](./session.md) — what `onSession` guarantees, what makes it re-query, and how an app behaves across a daemon restart. Start here if you are building a tap-to-render Station app.

## Stated limitations

- **No contract negotiation.** The SDK implements wire contract v1 and nothing advertises a version — see [Contract version and compatibility](../controller/wire-contract.md#contract-version-and-compatibility).
- **No offline queue.** A command dispatched while the Node is unreachable fails with `reason: "network"`; nothing is buffered for retry.
- **One `baseUrl` per client.** Talking to several Nodes means one client each, which is also what keeps their event streams and state mirrors separate.
