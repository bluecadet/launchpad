---
title: 🚀 Launchpad
titleTemplate: ':title'
---
<script setup>
  import PackageHeader from './components/PackageHeader.vue'
  import PackageCard from './components/PackageCard.vue'
</script>

<PackageHeader package="launchpad"/>

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

<ul class="card-grid">
  <PackageCard package="cli" href="./reference/cli" description="Command-line interface and configuration management" />
  <PackageCard package="content" href="./reference/content" description="Content pipeline and transformation tools" />
  <PackageCard package="monitor" href="./reference/monitor" description="Process monitoring and management" />
  <PackageCard package="scaffold" href="./reference/scaffold" description="Windows system configuration" />  
</ul>

<style scoped>
  .card-grid {
    list-style-type: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
    padding: 0;
  }
</style>

## Quick Start

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

>[!NOTE] Tip
> See the [Getting Started](/guides/getting-started) guide for detailed setup instructions.

---

Developed with ❤️ by [Bluecadet](https://bluecadet.com), available free and open-source under the MIT license.
