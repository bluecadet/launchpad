# 🚀 Launchpad

**A toolkit for building and managing interactive media installations**

Launchpad provides a collection of tools designed to streamline the development, deployment, and maintenance of media installations. It handles content management, process monitoring, system configuration, and more.

## Key Features

- 📂 **Content Management**: Fetch and transform content from any source
- 🔍 **Process Monitoring**: Keep your applications running reliably
- 🛠️ **System Configuration**: Automate Windows kiosk setup
- 💻 **Command Line Interface**: Easy-to-use commands for common operations
- 🔌 **Plugin Architecture**: Extend functionality with custom plugins

## Why Launchpad?

- **Reliable**: Built for 24/7 operation in museum environments
- **Flexible**: Modular design lets you use only what you need
- **Extensible**: Plugin system for custom functionality
- **Type-Safe**: Written in TypeScript with full type coverage

## Core Packages

- [@bluecadet/launchpad-cli](./reference/cli/index.md): Command-line interface and configuration management
- [@bluecadet/launchpad-content](./reference/content/index.md): Content pipeline and transformation tools
- [@bluecadet/launchpad-monitor](./reference/monitor/index.md): Process monitoring and management
- [@bluecadet/launchpad-scaffold](./reference/scaffold/index.md): Windows system configuration

## Quick Start

>[!NOTE] Tip
> See the [Getting Started](/guides/getting-started) guide for detailed setup instructions.



1. Install the packages you need:

```bash
npm install @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor
```

2. Create a configuration file:

```js
// launchpad.config.js
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  content: {
    sources: [
      // Content source configurations
    ]
  },
  monitor: {
    apps: [
      // Application configurations
    ]
  }
});
```

3. Run launchpad:

```bash
npx launchpad start
```