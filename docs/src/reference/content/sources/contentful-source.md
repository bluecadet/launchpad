# Contentful Content Source

The `contentfulSource` content source is used to fetch entries and assets from Contentful. It supports both published content (using the Content Delivery API) and draft content (using the Preview API), with built-in pagination handling.

## Usage

To use the `contentfulSource` content source, include it in the list of content sources in your configuration:

```typescript{1,6-13}
import { contentfulSource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
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
  }  
});
```

## Options

### `id`

- **Type:** `string`
- **Required**

Specifies the unique identifier for this source. This will be used as the download path.

### `space`

- **Type:** `string`
- **Required**

Your Contentful space ID.

### `deliveryToken`

- **Type:** `string`
- **Required** (unless using Preview API exclusively)

Content delivery token used to access published content.

### `previewToken`

- **Type:** `string`
- **Required** if `usePreviewApi` is true

Content preview token used to access draft/unpublished content.

### `usePreviewApi`

- **Type:** `boolean`
- **Default:** `false`

Set to true to use the Preview API instead of the Content Delivery API. Requires `previewToken` to be set.

### `contentTypes`

- **Type:** `string[]`
- **Default:** `[]`

Optionally limit queries to specific content types. This will also apply to linked assets. Types that link to other types will include up to 10 levels of child content.

### `locale`

- **Type:** `string`
- **Default:** `'en-US'`

Used to pull localized content.

### `filename`

- **Type:** `string`
- **Default:** `'content.json'`

The filename where content (entries and assets metadata) will be stored.

### `protocol`

- **Type:** `string`
- **Default:** `'https'`

The protocol to use for API requests.

### `host`

- **Type:** `string`
- **Default:** `'cdn.contentful.com'` or `'preview.contentful.com'` if `usePreviewApi` is true

The API host to use for requests.

### `searchParams`

- **Type:** `Record<string, unknown>`
- **Default:**

```typescript
{
  limit: 1000,
  include: 10
}
```

Additional search parameters to pass to the Contentful API. Supports all parameters from the [Contentful Content Delivery API](https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters).
