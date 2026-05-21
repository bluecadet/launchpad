# @bluecadet/launchpad-content

Content management tools for Launchpad interactive installations. Fetch, transform, and manage content from any source with a flexible plugin system.

## Documentation

For complete documentation, configuration options, and guides, visit:
[Launchpad Documentation](https://bluecadet.github.io/launchpad/)

## Features

- Fetch content from multiple sources (APIs, CMSs, etc.)
- Transform content with plugins
- Automatic backup and restore
- Error handling and logging
- Media file downloads and processing

## Installation

```bash
npm install @bluecadet/launchpad-content @bluecadet/launchpad-cli
```

## Basic Usage

```ts
// launchpad.config.ts
import { defineConfig } from '@bluecadet/launchpad-cli';
import { content } from '@bluecadet/launchpad-content';
import { monitor } from '@bluecadet/launchpad-monitor';
import { jsonSource } from '@bluecadet/launchpad-content';

export default defineConfig({
  plugins: [
    content({
      sources: [        // Add your content sources
        jsonSource({
          id: "api-data",
          files: {
            "data.json": "https://api.example.com/data"
          }
        })
      ],      
      transforms: [],   // Add your plugins
    }),
    monitor({
      apps: [],         // Add your apps to monitor
    }),
  ],
  workflows: {
    start: ['content.fetch', 'monitor.connect', 'monitor.start'],
    stop: ['monitor.stop', 'monitor.disconnect'],
  },
});
```

## License

ISC © Bluecadet
