# Creating a Custom Content Plugin

This recipe walks through creating a custom content plugin for Launchpad's content pipeline. Content plugins let you transform, analyze, or enhance content after it's downloaded.

## Overview

Content plugins in Launchpad:

- Run after content is downloaded from sources
- Can transform or process content
- Have access to a shared data store
- Can hook into different stages of the content pipeline
- Run in the order they are defined in your config

## Basic Plugin Structure

Here's a minimal plugin example:

```typescript
const myPlugin = {
  name: 'my-custom-plugin',
  hooks: {
    onContentFetchDone: async (ctx) => {
      // Your transformation logic here
    }
  }
}
```

## Step-by-Step Example

Let's create a plugin that adds a timestamp to every content item:

```typescript
const timestampPlugin = {
  name: 'timestamp-plugin',
  hooks: {
    // Runs after content is fetched
    onContentFetchDone: async ({ data, logger }) => {
      // Iterate through all documents
      for (const doc of data.documents()) {
        // Add timestamp to document
        doc.data.lastUpdated = new Date().toISOString();
        // Save changes back to data store
        await data.set(doc.id, doc.data);
      }
      
      logger.info('Added timestamps to all documents');
    }
  }
}
```

Add it to your Launchpad config:

```typescript
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  content: {
    sources: [ /* your sources */ ],
    plugins: [
      timestampPlugin
    ]
  }
});
```

## Available Hooks

Plugins can use these hooks:

- `onContentFetchSetup`: Before content download begins
- `onContentFetchDone`: After content is downloaded
- `onSetupError`: When setup fails
- `onContentFetchError`: When content fetch fails

>[!TIP]
>Choose hooks based on when you need to process content. Most transformations should use `onContentFetchDone`.

## Working with the Context

Each hook receives a context object with useful utilities:

```typescript
const myPlugin = {
  name: 'my-plugin',
  hooks: {
    onContentFetchDone: async (ctx) => {
      const {
        data,         // Access/modify content
        logger,       // Plugin-specific logging
        paths,        // Helper functions for paths
        abortSignal   // Check if process is stopping
        cwd,          // The launchpad configuration directory
      } = ctx;

      // Example: Log number of documents
      logger.info(`Processing ${data.size()} documents`);
    }
  }
}
```

## Best Practices

1. **Name your plugin clearly**: Use a descriptive, unique name
2. **Handle errors gracefully**: Use try/catch and log errors
3. **Clean up temporary files**: Use `paths.getTempPath()` for temp storage
4. **Log important operations**: Use the provided logger
5. **Check abort signal**: Respect process termination

```typescript
const bestPracticePlugin = {
  name: 'best-practice-plugin',
  hooks: {
    onContentFetchDone: async ({ data, logger, paths, abortSignal }) => {
      try {
        // Check if process is aborting
        if (abortSignal.aborted) return;

        // Use temp directory
        const tempDir = paths.getTempPath();
        
        // Log progress
        logger.info('Starting content processing...');

        // Your logic here...

      } catch (error) {
        logger.error('Plugin failed:', error);
        throw error; // Re-throw to notify Launchpad
      }
    }
  }
}
```

## Going Further

- See [Plugin Reference](../reference/content/plugins/index.md) for API details
- Check [Content Plugin Context](../reference/content/plugins/index.md#content-plugin-context) for full context documentation
- Explore [Built-in Plugins](../reference/content/plugins/index.md) for examples

>[!NOTE]
>Remember to handle errors appropriately and clean up any temporary files your plugin creates.
