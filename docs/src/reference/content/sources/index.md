# Content Sources

Content sources are used to fetch content from various external systems or APIs. These sources define how and where to retrieve content, which is then processed and transformed by content plugins.

## Type Reference

```typescript
type ContentSource = {
  id: string;
  fetch: (context: FetchContext) => SourceFetchResult | SourceFetchResult[];
};
```

## Properties

### `id`

The unique identifier for this source. The documents for this source will be written to a subdirectory with this name in the configured download directory.

### `fetch`

A sync callback for fetching the source data. Returns either a single document instance, or an array of documents.

## Fetch Context

### `logger`

A logger instance for logging messages and errors during the fetch process.

### `dataStore`

A data store instance for storing and retrieving fetched content. This is useful if one source needs to reference the data from a prior source. Ex: fetching shopify data based on the products referenced in a sanity api call.

## Source Fetch Result

### `id`

- **Type:** `string`

The unique identifier for the fetched document.

### `data`

- **Type:** `Promise<unknown> | AsyncIterable<unknown>`

The fetched data, either as a promise returning a single document or an async iterable returning multiple documents. If it's a promise, it will be written to a single json file. If it's an async iterable, each yield will be written to a separate json file with a index suffix (ie `data-001.json`).

## Example

To define a custom content source, use the `defineSource` function:

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

For detailed source configuration options, see the specific source documentation.
