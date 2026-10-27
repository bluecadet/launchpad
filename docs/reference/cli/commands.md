# CLI commands

Run each command with `npx launchpad <command>`, or `launchpad <command>` if installed globally. Run `launchpad` with no command, or `launchpad --help`, to list the built-in commands and the commands your configured plugins add.

| Command | Source | Description |
|---------|--------|-------------|
| `start` | Built-in | Start the controller |
| `stop` | Built-in | Stop the controller |
| `status` | Built-in | Show controller status |
| `content fetch` | Content plugin | Fetch all content sources |
| `monitor start` | Monitor plugin | Start the monitor |
| `monitor stop` | Monitor plugin | Stop the monitor |
| `monitor restart` | Monitor plugin | Restart monitored apps |
| `observability flush` | Observability plugin | Flush pending log batches to transports |

Plugin commands exist only when the plugin is in your config. If the config fails to load, plugin commands report the load error.

## Start command

```bash
launchpad start [options]
```

`start` launches the controller in **persistent mode** and opens an IPC socket. Later commands connect to that controller instead of starting their own.

| Option | Description |
|--------|-------------|
| `-d, --detach` | Run the controller in the background. Default: `false` |

```bash
launchpad start         # foreground
launchpad start -v      # verbose logging
launchpad start -vv     # verbose + debug logging
launchpad start -d      # background
```

## Stop command

```bash
launchpad stop
```

`stop` shuts down the running controller. It:

- Sends a graceful shutdown request over IPC
- Falls back to SIGTERM if IPC fails
- Sends SIGKILL as a last resort if the process doesn't respond
- Deletes the PID file

If no controller is running but a monitor process exists, `stop` stops the monitor process instead. This keeps older setups working.

## Status command

```bash
launchpad status [options]
```

`status` queries the running controller over IPC and prints a status snapshot: uptime, then one section per plugin that defines `summarize()`. It fails if no controller is running.

| Option | Description |
|--------|-------------|
| `-w, --watch` | Keep running and reprint the snapshot when it changes. Press Ctrl+C to exit. Default: `false` |

### Output example

```
Launchpad Status:
  Uptime: 2h 15m

Monitor:
  Connected: Yes
  Apps:
    ✓ my-app: online (PID: 12345)
    ✗ other-app: stopped

Content:
  Phase: idle
  Sources:
    ✓ cms: Success (1.2s)
```

## Plugin commands

Plugin commands run against the controller started by `launchpad start` when one is running. Otherwise they start a local controller for the command.

### `content fetch`

```bash
launchpad content fetch
```

Downloads content from every configured source, runs transforms, and publishes the result. Without a running controller, the local controller exits when the fetch completes.

### `monitor start`

```bash
launchpad monitor start
```

Connects to the process manager and starts the configured apps. Without a running controller, the local controller keeps running in the foreground to supervise the apps.

### `monitor stop`

```bash
launchpad monitor stop
```

Stops the monitored apps.

### `monitor restart`

```bash
launchpad monitor restart
```

Restarts the monitored apps.

### `observability flush`

```bash
launchpad observability flush
```

Force-flushes all pending log batches to the configured transports.

## Global options

All commands accept these options, before or after the command name:

| Option | Description | Type |
|--------|-------------|------|
| `-c, --config` | Path to your JS config file | string |
| `-e, --env` | Path(s) to your .env file(s) | array |
| `-E, --env-cascade` | Load env variables from `.env`, `.env.<arg>`, `.env.local`, and `.env.<arg>.local` in the Launchpad root | string |
| `-v, --verbose` | Increase logging verbosity. Repeat for debug output (`-vv`) | count |
| `--help` | Show help | flag |
