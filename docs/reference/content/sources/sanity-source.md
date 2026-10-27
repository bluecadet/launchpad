# Sanity content source

The `sanitySource` content source fetches data from Sanity with GROQ queries and paginates large datasets.

## Usage

Add it to the content `sources` list:

```typescript {1,7-16}
import { sanitySource } from '@bluecadet/launchpad/content/sources/sanity';

export default defineConfig({
  plugins: [
    content({
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
    })
  ]
});
```

## Options

### `id`

- **Type:** `string`
- **Required**

Unique identifier for this source, also used as its download directory name.

### `projectId`

- **Type:** `string`
- **Required**

Your Sanity project ID.

### `dataset`

- **Type:** `string`
- **Default:** `'production'`

Dataset to fetch from.

### `apiToken`

- **Type:** `string`
- **Optional**

Sanity API token. Required for private datasets.

### `apiVersion`

- **Type:** `string`
- **Default:** `'v2021-10-21'`

Sanity API version.

### `queries`

- **Type:** `Array<string | { query: string, id: string }>`
- **Required**

Queries to run. Each query is either:

- A document type string; for example, `'article'` fetches every document of type `article`
- An object with a custom GROQ query and an ID for the result set

> [!NOTE]
> A query that includes a range, such as `*[_type == "article"][0...100]` or `*[_type == "article"][0]`, runs as written and ignores `limit` and `maxNumPages`.

### `useCdn`

- **Type:** `boolean`
- **Default:** `true`

Set to `false` to bypass the CDN cache and get fresh data.

### `limit`

- **Type:** `number`
- **Default:** `100`

Maximum documents per page.

### `maxNumPages`

- **Type:** `number`
- **Default:** `1000`

Maximum pages to fetch.

### `mergePages`

- **Type:** `boolean`
- **Default:** `false`

When `true`, writes all pages to one file. When `false`, writes each page to its own file.
