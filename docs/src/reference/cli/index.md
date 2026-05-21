---
title: "@bluecadet/launchpad-cli"
---

<script setup>
  import PackageHeader from '../../components/PackageHeader.vue'
</script>

<PackageHeader package="cli" />

The CLI package provides a command-line interface for managing Launchpad installations. It serves as the primary entry point for running content management, process monitoring, and system configuration tasks.

## Features

- **Command Line Interface**: Easy-to-use commands for common operations:
  - Start/stop content downloads and app monitoring
  - Run content updates independently
  - Configure system settings
  - Access help documentation

- **Configuration Management**:
  - Load and parse config files
  - Environment variable handling with dotenv
  - Cascading configuration support
  - Type-safe config validation

- **Flexible Commands**:
  - `start`: Launch persistent controller (optional detached mode)
  - `stop`: Graceful shutdown of controller
  - `status`: Query running controller state
  - `content`: Content fetch operations (via IPC or ephemeral)
  - `monitor`: App monitoring operations (via IPC or ephemeral)

## Installation

The CLI can be installed globally via npm:

```bash
npm install @bluecadet/launchpad
```

## Usage

Once installed, you can run commands using the `launchpad` executable:

```bash
npx launchpad <command> [options]
```

For help:

```bash
npx launchpad help
```

> [!NOTE] Note:
> if installed globally (`npm install -g @bluecadet/launchpad`) you don't need the `npx` prefix when running commands.

See [Commands](./commands.md) for more information on the available commands.
