# @bluecadet/launchpad-content

Content management for Launchpad installations. Fetch content from APIs and CMSs, then transform it with plugins.

## Documentation

See the [Launchpad documentation](https://bluecadet.github.io/launchpad/) for guides and configuration options.

## Features

- Fetch content from multiple sources, such as APIs and CMSs
- Transform content with plugins
- Back up and restore content automatically
- Handle and log errors
- Download and process media files

## Installation

```bash
npm install @bluecadet/launchpad-content @bluecadet/launchpad-cli
```

## Basic usage

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

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
