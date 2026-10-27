---
title: "@bluecadet/launchpad-cli"
---

[github](https://github.com/bluecadet/launchpad/tree/main/packages/cli) ·
[npm](https://www.npmjs.com/package/@bluecadet/launchpad-cli) ·
[changelog](https://github.com/bluecadet/launchpad/blob/main/packages/cli/CHANGELOG.md)

The CLI package is the main entry point to Launchpad. Use it to run content management, process monitoring, and system configuration tasks.

## Features

- Commands for common operations:
  - Start and stop content downloads and app monitoring
  - Run content updates on their own
  - Configure system settings
  - Show help
- Configuration management:
  - Load and parse config files
  - Load environment variables with dotenv
  - Cascade `.env` files
  - Validate config with types
- Commands:
  - `start`: launch the persistent controller, optionally detached
  - `stop`: shut down the controller gracefully
  - `status`: query the running controller's state
  - `content`: fetch content, over IPC or with a temporary controller
  - `monitor`: monitor apps, over IPC or with a temporary controller

## Installation

Install the CLI with npm:

```bash
npm install @bluecadet/launchpad
```

## Usage

Run commands with the `launchpad` executable:

```bash
npx launchpad <command> [options]
```

For help:

```bash
npx launchpad help
```

> [!NOTE]
> If you install globally (`npm install -g @bluecadet/launchpad`), drop the `npx` prefix.

See [Commands](./commands.md) for the full command list.
