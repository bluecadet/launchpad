# Sanity Content Source

The `sanitySource` content source is used to fetch data from Sanity.io. It supports fetching data using GROQ queries and can handle pagination of large datasets.

## Usage

To use the `sanitySource` content source, include it in the list of content sources in your configuration:

```typescript{1,6-15}
import { sanitySource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    sources: [
      sanitySource({
        id: 'mySanitySource',
        projectId: 'your-project-id',
        dataset: 'production',
        apiToken: 'your-api-token', // Required for private datasets
        queries: [
          'project', // Fetches all documents of type 'project'
          { id: 'featured', query: '*[_type == "article" && featured == true]' }
        ]
      })
    ]
  }  
});
```

## Options

### `id`

- **Type:** `string`
- **Required**

Specifies the unique identifier for this source. This will be used as the download path.

### `projectId`

- **Type:** `string`
- **Required**

Your Sanity project ID.

### `dataset`

- **Type:** `string`
- **Default:** `'production'`

The name of the dataset you want to fetch from.

### `apiToken`

- **Type:** `string`
- **Optional**

Sanity API token. Required if you're accessing a private dataset.

### `apiVersion`

- **Type:** `string`
- **Default:** `'v2021-10-21'`

The Sanity API version to use.

### `queries`

- **Type:** `Array<string | { query: string, id: string }>`
- **Required**

An array of queries to fetch. Each query can be either:

- A string representing a document type (e.g., `'article'` will fetch all documents of type 'article')
- An object with a custom GROQ query and an ID for the result set

### `useCdn`

- **Type:** `boolean`
- **Default:** `true`

Set to `false` if you want to ensure fresh data instead of potentially cached responses.

### `limit`

- **Type:** `number`
- **Default:** `100`

Maximum number of documents to fetch per page.

### `maxNumPages`

- **Type:** `number`
- **Default:** `1000`

Maximum number of pages to fetch.

### `mergePages`

- **Type:** `boolean`
- **Default:** `false`

When `true`, combines all paginated results into a single file. When `false`, each page is stored separately.
