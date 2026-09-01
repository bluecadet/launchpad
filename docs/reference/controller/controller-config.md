---
title: "Controller Config"
---
The `controller` block configures the daemon itself — where it writes its pid file and IPC socket, how it logs, and how it identifies itself to remote clients.

```typescript
export default defineConfig({
  controller: {
    node: { id: 'gallery-kiosk-1', label: 'Gallery Kiosk 1', role: 'exhibit' },
  },
  plugins: [content({}), monitor({})],
});
```

Every option has a default, so omitting `controller` entirely is valid.

## Options

### `pidFile`

- **Type:** `string`
- **Default:** `".launchpad/launchpad.pid"`

Path to the pid file written in persistent mode. Relative paths resolve against the config file's directory. `launchpad stop` and the "is a daemon already running?" check both read this file.

### `socketPath`

- **Type:** `string`
- **Default:** `".launchpad/launchpad.sock"`

Path to the IPC socket (a named pipe on Windows) the CLI uses to talk to a running daemon. Relative paths resolve against the config file's directory.

### `logging`

- **Type:** `LogConfig`
- **Default:** `{}`

File logging configuration for the daemon's own log output.

### `node`

- **Type:** `NodeIdentity`
- **Default:** `{}`

Identity of this Node. A **Node** is one launchpad daemon and the machine it manages — the unit of addressing and identity in a connected exhibition.

Pid-file liveness (`process.kill(pid, 0)`) only works on the machine itself. A tablet or show-control system talking to eight Nodes over the network has no equivalent, and without an identity it can only tell responses apart by IP address. The Node identity is carried in system state, in `launchpad status`, and in the [`GET /status`](./wire-contract.md#get-status) snapshot header, so every response says which Node produced it.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | sanitized short hostname | Stable identifier for this Node. Must be non-empty. |
| `label` | `string` | the resolved `id` | Human-readable name, shown in `launchpad status`. |
| `role` | `string` | *(absent)* | Free-form Node role — a deployment tag such as `"exhibit"` or `"projection"`. Launchpad never interprets it. |

`label` always has a value on the wire: unconfigured, it mirrors `id`, so a consumer never has to fall back itself. `role` is genuinely absent when unset — it is missing from the JSON rather than `null`.

> [!NOTE]
> A Node role is unrelated to a token role. A Node role is a free-form deployment tag; a token role is a command allowlist attached to an HTTP transport token.

#### The hostname default

With no `node` block configured, `id` is derived from `os.hostname()`:

1. Lowercase the hostname.
2. Keep only the segment before the first `.` — macOS and Bonjour flip the suffix between `.local` and `.lan` depending on the network, which would otherwise change the id as a machine moves between networks.
3. Replace every run of characters outside `[a-z0-9-]` with a single `-`, then trim leading and trailing dashes.
4. If nothing survives, use `launchpad-node`.

So `Gallery-Kiosk-1.local` becomes `gallery-kiosk-1`, and `Kiosk_A 2` becomes `kiosk-a-2`.

The default exists so that existing configs keep working and a single-Node project needs no configuration at all. It is not a guarantee of uniqueness — two machines both named `localhost` derive the same id, and renaming a machine silently changes its id. **Set `node.id` explicitly on anything deployed.**

#### A two-Node example

```typescript
// gallery/launchpad.config.js
export default defineConfig({
  controller: {
    node: { id: 'gallery-kiosk-1', label: 'Gallery Kiosk 1', role: 'exhibit' },
  },
});

// lobby/launchpad.config.js
export default defineConfig({
  controller: {
    node: { id: 'lobby-projection', label: 'Lobby Projection', role: 'projection' },
  },
});
```

A client polling both Nodes reads `header.node.id` off each `GET /status` response to tell them apart:

```json
{
  "header": {
    "startTime": "2026-07-14T15:30:47.112Z",
    "uptimeMs": 8100000,
    "mode": "persistent",
    "node": { "id": "gallery-kiosk-1", "label": "Gallery Kiosk 1", "role": "exhibit" }
  },
  "sections": []
}
```

The identity is fixed for the daemon's lifetime; it never changes while the process runs.
