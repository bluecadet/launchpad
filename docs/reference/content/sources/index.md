# Content sources

A content source defines how and where to fetch content from an external system or API. Content transforms then process the fetched content.

## Type reference

```typescript
type ContentSource = {
  id: string;
  fetch: (context: FetchContext) => SourceFetchResult | SourceFetchResult[];
};
```

## Properties

### `id`

Unique identifier for this source. Its documents are written to a subdirectory with this name in the download directory.

### `fetch`

Synchronous callback that returns one document or an array of documents. Each document's `data` is a promise or async iterable.

## Fetch context

### `logger`

Logger for messages and errors during the fetch.

### `dataStore`

Data store for storing and retrieving fetched content. Use it when a source depends on data from an earlier source, such as fetching Shopify data for products referenced in a Sanity query.

## Source fetch result

### `id`

- **Type:** `string`

Unique identifier for the fetched document.

### `data`

- **Type:** `Promise<unknown> | AsyncIterable<unknown>`

The fetched data. A promise resolving to one document is written to a single JSON file. An async iterable yielding several documents writes each yield to its own JSON file with an index suffix, such as `data-001.json`.

## Example

Define a custom content source with `defineSource`:

```typescript
import { defineSource } from '@bluecadet/launchpad/content/source';

export default defineSource({
  id: 'myCustomSource',
  fetch: (context) => {
    return {
      id: 'documentId',
      data: fetchDataFromAPI(),
    };
  },
});
```

Each built-in source's page lists its configuration options.
