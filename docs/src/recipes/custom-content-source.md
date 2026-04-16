# Creating a Custom Content Source

This recipe explains how to create a custom content source for Launchpad. Content sources allow you to fetch data from any external system and integrate it into Launchpad's content pipeline.

## Overview

Content sources in Launchpad:

- Define where and how to fetch content
- Return data in a standardized format
- Can fetch from APIs, databases, files, or any data source
- Run before content plugins process the data

## Basic Source Structure

Here's a minimal content source example:

```typescript
import { defineSource } from '@bluecadet/launchpad/content/source';

export default defineSource({
  id: 'my-custom-source',
  fetch: async ({ logger }) => {
    return {
      id: 'my-document',
      data: Promise.resolve({ hello: 'world' })
    };
  }
});
```

## Step-by-Step Example

Let's create a source that fetches data from a REST API:

```typescript
import { defineSource } from '@bluecadet/launchpad/content/source';

const myApiSource = defineSource({
  id: 'api-source',
  fetch: async ({ logger }) => {
    try {
      // Log the fetch operation
      logger.info('Fetching data from API...');

      // Fetch data from API
      const response = await fetch('https://api.example.com/data');
      const data = await response.json();

      // Return in expected format
      return {
        id: 'api-data',
        data: Promise.resolve(data)
      };
    } catch (error) {
      logger.error('Failed to fetch:', error);
      throw error;
    }
  }
});
```

>[!NOTE]
>Remember to handle errors appropriately and implement proper logging for better debugging.

Add it to your Launchpad config:

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';

export default defineConfig({
  plugins: [
    content({
      sources: [
        myApiSource
      ]
    })
  ],
});
```

## Multiple Documents

Sources can return multiple documents:

```typescript
const multiDocSource = defineSource({
  id: 'multi-doc-source',
  fetch: async ({ logger }) => {
    return [
      {
        id: 'doc-1',
        data: Promise.resolve({ title: 'First Document' })
      },
      {
        id: 'doc-2',
        data: Promise.resolve({ title: 'Second Document' })
      }
    ];
  }
});
```

## Paginated Data

For large datasets, use AsyncIterables:

```typescript
const streamingSource = defineSource({
  id: 'stream-source',
  fetch: async ({ logger }) => ({
    id: 'large-dataset',
    data: (async function* () {
      for (let i = 0; i < 1000; i++) {
        yield { index: i };
      }
    })()
  })
});
```

## Best Practices

1. **Use Meaningful IDs**: Choose descriptive, unique IDs for your source and documents
2. **Handle Errors**: Implement proper error handling and logging
3. **Respect Rate Limits**: Add delays between API calls if needed
4. **Document Requirements**: List any API keys or configuration needed
5. **Validate Data**: Check that fetched data matches expected format

>[!TIP]
>Use TypeScript for better type safety and autocompletion when configuring your source.

## Next Steps

- Learn about [Content Sources](../reference/content/sources/index.md) for full API details
- Explore [Content Plugins](../reference/content/transforms/index.md) to process your fetched data
- See the [Content Configuration Reference](../reference/content/content-config.md) for config options
- Check [Built-in Sources](../reference/content/sources/index.md) for implementation examples
