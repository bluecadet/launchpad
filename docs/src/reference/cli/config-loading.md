# Config Loading

The Launchpad CLI uses a flexible configuration system that automatically searches for and loads your project configuration. The CLI supports Javascript config files.

## Config File Search

The CLI searches for config files with the following names:

1. `launchpad.config.js`
2. `launchpad.config.mjs`
3. `launchpad.config.ts`
4. `launchpad.config.cjs`
5. `launchpad.config.mts`
6. `launchpad.config.cts`

The search starts in the current working directory and recursively searches up parent directories (up to 64 levels) until a config file is found.

## Config File Format

### JavaScript/TypeScript Config (Recommended)

```js
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  content: {
    // Content management configuration
  },
  monitor: {
    // Process monitoring configuration
  },
});
```

## Configuration Structure

Your config file can include settings for any of Launchpad's main modules:

- `content` - Content management settings ([Content Config Reference](../content/content-config))
- `monitor` - Process monitoring settings ([Monitor Config Reference](../monitor/monitor-config))

## Environment Variables

Config files can reference environment variables using the `process.env` object in JavaScript configs. For managing environment variables, see the [Environment Variables](./env) documentation.

## Type Safety

When using TypeScript or an editor with TypeScript support (like VS Code), the `defineConfig` helper provides:

- Full IntelliSense for all configuration options
- Type checking for configuration values
- Auto-completion suggestions
- Documentation hints

## Example

```js
import { defineConfig } from '@bluecadet/launchpad-cli';
import { jsonSource } from '@bluecadet/launchpad-content/sources/json';

export default defineConfig({
  content: {
    sources: [
      jsonSource({
        id: "api-data",
        files: {
          "data.json": process.env.API_ENDPOINT
        }
      })
    ],
    downloadPath: "./content"
  },
  monitor: {
    apps: [
      {
        pm2: {
          name: "exhibit-app",
          script: "./app.exe"
        }
      }
    ]
  }
});
```
