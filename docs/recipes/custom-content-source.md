# Creating a custom content source

A custom content source brings data from any external system into Launchpad's content pipeline.

## Overview

Content sources:

- Define where and how to fetch content
- Return data in a standard format
- Can fetch from APIs, databases, files, or any other system
- Run before content transforms

## Basic source structure

A minimal content source:

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

## Example: REST API source

This source fetches data from a REST API:

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

## Multiple documents

A source can return multiple documents:

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

## Paginated data

For large datasets, return an `AsyncIterable`:

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

## Best practices

1. Give sources and documents descriptive, unique IDs.
2. Log and handle errors.
3. Respect rate limits; add delays between API calls if needed.
4. Document required API keys and configuration.
5. Check that fetched data matches the expected format.

>[!TIP]
>Write your source in TypeScript for type checking and autocompletion.

## Next steps

- [Content sources](../reference/content/sources/index.md) for the full API and built-in implementations
- [Content transforms](../reference/content/transforms/index.md) to process fetched data
- [Content configuration reference](/reference/content/content-config/) for config options
