# Getting started

## Quick start

Run the project generator:

```bash
npm create @bluecadet/launchpad
```

It asks which plugins you need and generates a working `launchpad.config.ts`. See [Creating a project](./creating-a-project.md) for details.

## Manual installation

Install `@bluecadet/launchpad`, which includes the CLI and all first-party plugins:

```bash
npm install @bluecadet/launchpad
```

CMS integrations and image processing need extra peer dependencies. See [Packages and modularity](./packages.md) for the list. The project generator installs them for you.

> [!TIP]
> You can install individual packages (`@bluecadet/launchpad-content`, `@bluecadet/launchpad-monitor`, etc.) instead of the umbrella. Both behave the same at runtime. See [Packages and modularity](./packages.md) for when to prefer each.

## Basic setup

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

2. Run Launchpad:

```bash
# Download content and start apps
npx launchpad start

# Only download fresh content
npx launchpad content fetch

# Only manage apps
npx launchpad monitor start

# Stop any running launchpad processes
npx launchpad stop
```
