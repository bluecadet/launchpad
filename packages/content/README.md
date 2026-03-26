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

```js
// launchpad.config.js
import { defineConfig } from '@bluecadet/launchpad-cli';
import { jsonSource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    sources: [
      jsonSource({
        id: "api-data",
        files: {
          "data.json": "https://api.example.com/data"
        }
      })
    ]
  }
});
```

## License

ISC © Bluecadet
