# CLI Commands

Launchpad provides several commands to manage your media installations. Each command can be run using `npx launchpad <command>` or just `launchpad <command>` if installed globally.

## Start Command

```bash
launchpad start [options]
```

The `start` command is the primary way to launch your application. It:

1. Downloads fresh content from configured sources
2. Starts and monitors configured applications
3. Initializes health monitoring if configured

## Stop Command

```bash
launchpad stop [options]
```

The `stop` command gracefully shuts down all Launchpad processes:

- Stops all monitored applications
- Kills any existing PM2 instances
- Cleans up temporary files

## Content Command

```bash
launchpad content [options]
```

Use this command to manage content independently:

- Downloads fresh content from all configured sources
- Runs content transformations
- Updates local content cache
- Does not start or affect running applications

This is useful for updating content without restarting applications.

## Monitor Command

```bash
launchpad monitor [options]
```

The `monitor` command focuses on application management:

- Starts configured applications
- Monitors for crashes and restarts as needed
- Collects process statistics
- Does not download or update content

Use this when you want to restart applications without refreshing content.

## Scaffold Command

```bash
launchpad scaffold [options]
```

This command configures Windows PCs for exhibit environments:

- Requires administrative privileges
- Configures Windows kiosk mode
- Optimizes power settings
- Sets up common exhibit configurations
- Applies system-level settings

## Global Options

All commands support these options:

| Option | Description | Type |
|--------|-------------|------|
| `--config, -c` | Path to your JS config file | string |
| `--env, -e` | Path(s) to your .env file(s) | array |
| `--env-cascade, -E` | Cascade env variables from multiple .env files | string |
| `--help` | Show help information | flag |
