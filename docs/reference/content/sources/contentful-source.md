# Contentful content source

The `contentfulSource` content source fetches entries and assets from Contentful and handles pagination. It reads published content through the Content Delivery API or draft content through the Preview API.

## Usage

Add it to the content `sources` list:

```typescript {1,7-14}
import { contentfulSource } from '@bluecadet/launchpad/content/sources/contentful';

export default defineConfig({
  plugins: [
    content({
      sources: [
        contentfulSource({
          id: 'myContentfulSource',
          space: 'spaceXXXXXXXXXXXX',
          deliveryToken: 'your-delivery-token',
          previewToken: 'your-preview-token', // Optional
          contentTypes: ['article', 'page'], // Optional
          usePreviewApi: false // Optional
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

### `space`

- **Type:** `string`
- **Required**

Your Contentful space ID.

### `deliveryToken`

- **Type:** `string`
- **Required** (unless using Preview API exclusively)

Content Delivery API token for published content.

### `previewToken`

- **Type:** `string`
- **Required** if `usePreviewApi` is true

Preview API token for draft and unpublished content.

### `usePreviewApi`

- **Type:** `boolean`
- **Default:** `false`

When `true`, uses the Preview API instead of the Content Delivery API. Requires `previewToken`.

### `contentTypes`

- **Type:** `string[]`
- **Default:** `[]`

Limits queries, including linked assets, to these content types. Types that link to other types include up to 10 levels of child content.

### `filename`

- **Type:** `string`
- **Default:** `'content.json'`

File that stores entries and asset metadata.

### `protocol`

- **Type:** `string`
- **Default:** `'https'`

Protocol added to asset URLs, which Contentful returns without one, so `mediaDownloader` can fetch them.

### `host`

- **Type:** `string`
- **Default:** `'cdn.contentful.com'` or `'preview.contentful.com'` if `usePreviewApi` is true

API host for requests.

### `searchParams`

- **Type:** `Record<string, unknown>`
- **Default:**

```typescript
{
  limit: 1000,
  include: 10
}
```

Extra search parameters for the Contentful API. Accepts any [Content Delivery API search parameter](https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters).
