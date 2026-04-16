# Getting Started

## Quick Start

The fastest way to get set up is with the scaffolding tool:

```bash
npm create @bluecadet/launchpad
```

It will ask which plugins you need, configure everything, and generate a working `launchpad.config.ts`. See [Creating a Project](./creating-a-project.md) for details.

## Manual Installation

Install the `@bluecadet/launchpad` package, which includes the CLI and all first-party plugins:

```bash
npm install @bluecadet/launchpad
```

If you use CMS integrations or image processing, also install the relevant peer dependencies — see [Packages and Modularity](./packages.md) for the full list.

The scaffolding tool handles this automatically.

> [!TIP]
> You can also install individual packages (`@bluecadet/launchpad-content`, `@bluecadet/launchpad-monitor`, etc.) instead of the umbrella. Both work identically at runtime. See [Packages and Modularity](./packages.md) for when to prefer one over the other.

## Basic Setup

1. Create a configuration file:

```js
// launchpad.config.js (or .ts, .mjs, etc.)
import { defineConfig } from '@bluecadet/launchpad/cli';
import { content } from '@bluecadet/launchpad/content';
import { monitor } from '@bluecadet/launchpad/monitor';
import { jsonSource } from '@bluecadet/launchpad/content/sources';

export default defineConfig({
  plugins: [
    content({
      sources: [
        jsonSource({
          id: "flickr-images",
          files: {
            "spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
            "rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket",
          },
        }),
      ]
    }),
    monitor({
      apps: [
        {
          pm2: {
            name: "my-app",
            script: "my-app.exe",
            cwd: "./builds/",
          }
        }
      ]
    }),
  ]
});
```

2. Run launchpad:

```bash
# Download content and start apps
npx launchpad start

# Only download fresh content
npx launchpad content

# Only manage apps
npx launchpad monitor

# Stop any running launchpad processes
npx launchpad stop
```
