# CLI Commands

Launchpad provides several CLI commands to manage your exhibit:

## General Options

- `-c, --config <path>` - Path to your JS config file
- `-e, --env <paths...>` - Path(s) to your .env file(s)
- `-E, --env-cascade <env>` - Cascade env variables from `.env`, `.env.local`, `.env.<arg>`, `.env.<arg>.local`

## Core Commands

### `launchpad start`

Starts Launchpad by updating content and starting apps.

Requires installing `@bluecadet/launchpad-content` and `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad` as a dependency.

```bash
launchpad start [options]
```

### `launchpad stop`

Stops Launchpad by stopping apps and killing any existing PM2 instance.

Requires installing `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad` as a dependency.

```bash
launchpad stop
```

### `launchpad content`

Only starts apps without downloading content.

Requires installing `@bluecadet/launchpad-content` or `@bluecadet/launchpad` as a dependency.

```bash
launchpad content
```

### `launchpad monitor`

Only starts apps without downloading content.

Requires installing `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad` as a dependency.

```bash
launchpad monitor
```

### `launchpad scaffold`

Configures the current PC for exhibit environments (requires admin privileges).

Requires installing `@bluecadet/launchpad-scaffold` or `@bluecadet/launchpad` as a dependency.

```bash
launchpad scaffold
```