# Strapi content source

The `strapiSource` content source fetches data from Strapi v3, v4, or v5, with automatic pagination and custom query parameters.

## Usage

Add it to the content `sources` list:

```typescript {1,7-14}
import { strapiSource } from '@bluecadet/launchpad/content/sources/strapi';

export default defineConfig({
  plugins: [
    content({
      sources: [
        strapiSource({
          id: 'myStrapiSource',
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

Unique identifier for this source, also used as its download directory name.

### `version`

- **Type:** `"3" | "4" | "5"`
- **Default:** `"5"`

Strapi version. Strapi v5 puts entry attributes at the top level of each entry, next to a `documentId`, where v4 nests them under `attributes`; this source passes v5 entries through unchanged. For an older Strapi instance, set this to `"3"` or `"4"`.

### `baseUrl`

- **Type:** `string`
- **Required**

Base URL of your Strapi instance, with or without a trailing slash.

### `queries`

- **Type:** `(string | { contentType: string, params: Record<string, any> })[]`
- **Required**

One query per content type to fetch. Each query is either:

- A URL path string, such as `"api/articles"`
- An object with `contentType` and `params`, to set query parameters

### `identifier`

- **Type:** `string`
- **Required if token not provided**

Username or email for authentication. Set it through an environment variable.

### `password`

- **Type:** `string`
- **Required if token not provided**

Password for authentication. Set it through an environment variable.

### `token`

- **Type:** `string`
- **Required if identifier/password not provided**

Previously generated JWT for authentication.

### `limit`

- **Type:** `number`
- **Default:** `100`

Maximum entries per page.

### `maxNumPages`

- **Type:** `number`
- **Default:** `1000`

Maximum pages to fetch.
