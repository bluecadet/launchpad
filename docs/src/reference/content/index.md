# @Bluecadet/Launchpad-Content

The content package is a powerful tool for downloading, transforming, and managing content from various sources. It provides a flexible, plugin-based architecture for handling content pipelines.

## Features

- **Extensible Source System**: Easily connect to any content source:
  - Build custom source adapters with a simple interface
  - Includes ready-to-use adapters for popular CMSs (Contentful, Airtable, Sanity, etc.)
  - Type-safe data fetching and validation

- **Flexible Plugin Architecture**: Transform and process content your way:
  - Create custom plugins with straightforward APIs
  - Chain multiple transformations
  - Built-in plugins for common tasks (Markdown, image processing, etc.)
  - Full control over the content pipeline

- **Robust Content Management**:
  - Intelligent diffing for efficient updates
  - Automatic backup and recovery
  - Configurable file organization
  - Temporary file cleanup
  - Progress tracking and detailed logging

## Installation

```bash
npm install @bluecadet/launchpad-content
```

## Basic Usage

```typescript
import LaunchpadContent from '@bluecadet/launchpad-content';

const content = new LaunchpadContent({
  sources: [
    // Content source configurations
  ],
  plugins: [
    // Plugin configurations
  ],
  downloadPath: './content'
});

// Start content download and processing
await content.start();
```

## Configuration

Content operations are configured through a `ContentConfig` object that specifies:

- **Sources**: Array of content sources to fetch from
- **Plugins**: Array of plugins for content processing
- **Paths**: Various path configurations for content storage
- **Backup Options**: Settings for content backup and restoration

See the [Content Config](./content-config) section for detailed configuration options.

## Plugins

The plugin system is core to the content package's functionality. Plugins can:

- Transform content formats
- Process media files
- Add custom processing steps
- Handle errors and logging

Learn more about available plugins and creating custom ones in the [Plugins](./plugins/index.md) section.

## Error Handling

The package uses the `neverthrow` library for robust error handling:

- Type-safe error handling
- Clear error boundaries
- Graceful failure recovery
- Automatic backup restoration on errors when configured
