---
title: Launchpad
titleTemplate: ':title'
---
<script setup>
  import PackageHeader from './components/PackageHeader.vue'
  import PackageCard from './components/PackageCard.vue'
</script>

<PackageHeader package="launchpad"/>

Launchpad provides a collection of tools designed to streamline the development, deployment, and maintenance of media installations. It handles content management, process monitoring, and more.

## Key Features

- 📂 **Content Management**: Fetch and transform content from any source
- 🔍 **Process Monitoring**: Keep your applications running reliably
- 💻 **Command Line Interface**: Easy-to-use commands for common operations
- 🔌 **Plugin Architecture**: Extend functionality with custom plugins
- 📊 **Observability**: Forward logs and events to external aggregators

## Why Launchpad?

- **Reliable**: Built for 24/7 operation in museum environments
- **Flexible**: Modular design lets you use only what you need
- **Extensible**: Plugin system for custom functionality
- **Type-Safe**: Written in TypeScript with full type coverage

## Core Packages

<ul class="card-grid">
  <PackageCard package="cli" href="./reference/cli" description="Command-line interface and configuration management" />
  <PackageCard package="controller" href="./reference/controller" description="Central orchestration and event system" />
  <PackageCard package="content" href="./reference/content" description="Content pipeline and transformation tools" />
  <PackageCard package="monitor" href="./reference/monitor" description="Process monitoring and management" />
  <PackageCard package="observability" href="./reference/observability" description="Log aggregation and event forwarding to Grafana Loki and other backends" />
</ul>

> [!TIP] Windows system setup
> Looking to configure a Windows kiosk or exhibit machine? Check out [Preflight](https://github.com/bluecadet/preflight) — a dedicated tool for Windows system configuration built by Bluecadet.

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
npm install @bluecadet/launchpad
```

2. Create a configuration file:

```ts
// launchpad.config.ts
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { monitor } from '@bluecadet/launchpad/monitor';

export default defineConfig({
  plugins: [
    content({
      sources: [],      // Add your content sources
      transforms: [],   // Add your transforms
    }),
    monitor({
      apps: [],         // Add your apps to monitor
    }),
  ]
});
```

3. Run launchpad:

```bash
npx launchpad start
```

>[!NOTE] Tip
> See the [Getting Started](/guides/getting-started) guide for detailed setup instructions.

---

Developed with ❤️ by [Bluecadet](https://bluecadet.com), available free and open-source under the ISC license. Third-party dependencies retain their own licenses.
