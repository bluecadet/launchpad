# Getting Started

## Installation

Launchpad is modular - you can install just the packages you need:

```bash
# Install the CLI (required)
npm install @bluecadet/launchpad-cli

# Install content management (optional)
npm install @bluecadet/launchpad-content

# Install process monitoring (optional)
npm install @bluecadet/launchpad-monitor

# Install system configuration (optional)
npm install @bluecadet/launchpad-scaffold
```

Alternatively, install everything at once:

```bash
npm install @bluecadet/launchpad
```

## Basic Setup

1. Create a configuration file:

```js
// launchpad.config.js (or launchpad.config.ts, launchpad.config.mjs, etc.)
import { defineConfig } from '@bluecadet/launchpad-cli';
import { jsonSource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    // Content management configuration
    sources: [
      jsonSource({
        id: "flickr-images",
        files: {
          "spaceships.json":
            "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
          "rockets.json":
            "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket",
        },
      }),
    ]
  },
  monitor: {
    // Process management configuration
    apps: [
      {
        pm2: {
          name: "my-app",
          script: "my-app.exe",
          cwd: "./builds/",
        }
      }
    ]
  }
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
