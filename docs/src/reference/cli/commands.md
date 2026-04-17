# CLI Commands

Launchpad provides several commands to manage your media installations. Each command can be run using `npx launchpad <command>` or just `launchpad <command>` if installed globally.

## Start Command

```bash
launchpad start [options]
```

The `start` command launches Launchpad in **persistent mode**, which opens an IPC socket allowing subsequent CLI commands to connect to the running controller instance. This enables:

- Starting a long-running controller that manages both content and monitor subsystems
- Running background processes with optional detached mode
- Executing subsequent commands (content, monitor, status) via IPC without redundant initialization

### Options

| Option | Description |
|--------|-------------|
| `-d, --detach` | Run the controller in the background (detached mode) |

### Usage Examples

Start in foreground (useful for development/debugging):
```bash
launchpad start
# or
launchpad start -v # with verbose logging
launchpad start -vv # with verbose + debug logging
```

Start in background:
```bash
launchpad start --detach
# or
launchpad start -d
```

Once started, you can use other commands to interact with the running controller via IPC.

## Stop Command

```bash
launchpad stop [options]
```

The `stop` command gracefully shuts down the running Launchpad controller:

- Sends graceful shutdown signal via IPC
- Falls back to SIGTERM if IPC fails
- Force kills (SIGKILL) as last resort if the process doesn't respond
- Cleans up the PID file

For compatibility, if the controller is not running but a monitor process exists, it attempts to stop the monitor process.

## Status Command

```bash
launchpad status [options]
```

The `status` command queries the persistent controller for its current state via IPC:

- Shows controller uptime
- Displays monitor connection status
- Lists all running apps with their status and PID
- Shows content fetch status and last fetch time

### Output Example

```
Launchpad Status:
  Uptime: 2h 15m

Monitor:
  Connected: Yes
  PM2 Version: 5.3.0

Apps:
  ● my-app: online (PID: 12345)
  ○ other-app: stopped

Content:
  Last Fetch: 2025-10-21T10:30:00.000Z
  In Progress: No
```

## Content Command

```bash
launchpad content [options]
```

The `content` command runs a content fetch operation:

- If a controller is already running (via `launchpad start`), it sends the command via IPC
- If no controller is running, it starts an ephemeral one for the fetch operation
- Downloads fresh content from all configured sources
- Runs content transformations
- Updates local content cache

This is useful for updating content without restarting applications or the controller.

## Monitor Command

```bash
launchpad monitor [options]
```

The `monitor` command manages applications:

- If a controller is already running (via `launchpad start`), it connects and starts monitoring via IPC
- If no controller is running, it starts an ephemeral one for monitoring
- Starts configured applications
- Monitors for crashes and restarts as needed
- Collects process statistics

Use this when you want to manage applications independently or connect to an existing controller instance.

## Global Options

All commands support these options:

| Option | Description | Type |
|--------|-------------|------|
| `--config, -c` | Path to your JS config file | string |
| `--env, -e` | Path(s) to your .env file(s) | array |
| `--env-cascade, -E` | Cascade env variables from multiple .env files | string |
| `-verbose, -v` | Increase logging verbosity | count |
| `--help` | Show help information | flag |
