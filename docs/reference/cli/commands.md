# CLI commands

Run each command with `npx launchpad <command>`, or `launchpad <command>` if installed globally.

## Start command

```bash
launchpad start [options]
```

`start` launches Launchpad in **persistent mode** and opens an IPC socket so later CLI commands can connect to the running controller. Use it to:

- Run a long-lived controller that manages the content and monitor subsystems
- Run in the background with detached mode
- Send later commands (content, monitor, status) over IPC without reinitializing

### Options

| Option | Description |
|--------|-------------|
| `-d, --detach` | Run the controller in the background |

### Usage examples

Start in the foreground, for development and debugging:
```bash
launchpad start
# or
launchpad start -v # with verbose logging
launchpad start -vv # with verbose + debug logging
```

Start in the background:
```bash
launchpad start --detach
# or
launchpad start -d
```

Other commands then talk to the running controller over IPC.

## Stop command

```bash
launchpad stop [options]
```

`stop` shuts down the running controller. It:

- Sends a graceful shutdown request over IPC
- Falls back to SIGTERM if IPC fails
- Sends SIGKILL as a last resort if the process doesn't respond
- Deletes the PID file

If the controller isn't running but a monitor process exists, `stop` tries to stop the monitor process. This keeps older setups working.

## Status command

```bash
launchpad status [options]
```

`status` asks the persistent controller for its current state over IPC and shows:

- Controller uptime
- Monitor connection status
- Each running app with its status and PID
- Content fetch status and last fetch time

### Output example

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

## Content command

```bash
launchpad content [options]
```

`content` fetches content:

- If a controller is running (via `launchpad start`), it sends the command over IPC
- Otherwise, it starts a temporary controller for the fetch
- Downloads content from every configured source
- Runs content transforms
- Updates the local content cache

Use it to update content without restarting apps or the controller.

## Monitor command

```bash
launchpad monitor [options]
```

`monitor` manages applications:

- If a controller is running (via `launchpad start`), it connects and starts monitoring over IPC
- Otherwise, it starts a temporary controller for monitoring
- Starts configured applications
- Restarts apps that crash
- Collects process statistics

Use it to manage applications on their own or through an existing controller.

## Global options

Run `launchpad` without a command to list the built-in and configured plugin commands.

All commands accept these options:

| Option | Description | Type |
|--------|-------------|------|
| `--config, -c` | Path to your JS config file | string |
| `--env, -e` | Path(s) to your .env file(s) | array |
| `--env-cascade, -E` | Load env variables from a cascade of .env files | string |
| `--verbose, -v` | Increase logging verbosity | count |
| `--help` | Show help | flag |
