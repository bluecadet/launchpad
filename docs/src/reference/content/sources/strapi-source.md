# Strapi Content Source

The `strapiSource` content source is used to fetch data from Strapi CMS. It supports both Strapi v3 and v4, with automatic pagination and customizable query parameters.

## Usage

To use the `strapiSource` content source, include it in the list of content sources in your configuration:

```typescript{1,7-14}
import { strapiSource } from '@bluecadet/launchpad-content/sources/strapi';

export default defineConfig({
  plugins: [
    content({
      sources: [
        strapiSource({
          id: 'myStrapiSource',
          version: '4',
          baseUrl: 'http://localhost:1337',
          identifier: 'admin@example.com',
          password: 'your-password',
          queries: ['api/articles', 'api/categories']
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

Specifies the unique identifier for this source. This will be used as the download path.

### `version`

- **Type:** `"3" | "4"`
- **Default:** `"3"`

Specifies the Strapi version. Supports either version 3 or 4.

### `baseUrl`

- **Type:** `string`
- **Required**

The base URL of your Strapi CMS (with or without trailing slash).

### `queries`

- **Type:** `(string | { contentType: string, params: Record<string, any> })[]`
- **Required**

Queries for each type of content you want to fetch. You can specify either:
- A string URL path (e.g. `"api/articles"`)
- An object with `contentType` and `params` for more control over the query parameters

### `identifier`

- **Type:** `string`
- **Required if token not provided**

Username or email for authentication. Should be configured via environment variables.

### `password`

- **Type:** `string`
- **Required if token not provided**

Password for authentication. Should be configured via environment variables.

### `token`

- **Type:** `string`
- **Required if identifier/password not provided**

A previously generated JWT token for authentication.

### `limit`

- **Type:** `number`
- **Default:** `100`

Maximum number of entries to fetch per page.

### `maxNumPages`

- **Type:** `number`
- **Default:** `1000`

Maximum number of pages to fetch.

### `pageNumZeroPad`

- **Type:** `number`
- **Default:** `2`

Number of zeros to pad each JSON filename index with.

