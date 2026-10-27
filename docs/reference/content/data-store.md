# DataStore

The DataStore is file-system-backed storage for content during fetch and transform. It stores and retrieves documents grouped into namespaces.

## Core concepts

### Namespaces

A namespace holds the documents from one source. Each content source gets its own namespace, named by the source's ID.

### Documents

A document is a file of content data: either a single JSON file or a set of batched files for paginated content.

## API reference

### DataStore

#### `createNamespace(namespaceId: string)`

Creates a namespace. Returns a Result containing the namespace.

#### `namespace(namespaceId: string)`

Gets an existing namespace. Returns a Result containing the namespace.

#### `getDocument(namespaceId: string, documentId: string)`

Gets a document from a namespace. Returns a Result containing the document.

#### `filter(ids?: DataKeys)`

Filters documents by namespace and document IDs. Returns results grouped by namespace.

### Namespace

#### `insert<T>(id: string, data: Promise<T> | AsyncIterable<T>)`

Inserts a document into the namespace. Pass a Promise for a single document or an AsyncIterable for batched documents.

#### `document(id: string)`

Gets a document by ID from the namespace.

#### `documents()`

Gets all documents in the namespace.

#### `waitFor(id: string)`

Returns a promise that resolves once the document with the given ID is written.

### Document

#### `update(cb: (data: T) => T | Promise<T>)`

Updates the document's content with a callback.

#### `apply(pathExpression: string, fn: (x: unknown) => unknown)`

Applies a function to the values at a JSONPath expression.

#### `query(pathExpression: string)`

Queries the document's content with a JSONPath expression.

## Error handling

Most methods return a `neverthrow` `Result` or `ResultAsync`:

```typescript
const namespaceResult = dataStore.namespace('my-source');
if (namespaceResult.isErr()) {
  console.error('Error:', namespaceResult.error);
} else {
  const namespace = namespaceResult.value;
  // Use namespace...
}
```

Chain async operations with `andThen`:

```typescript
await dataStore
  .createNamespace('my-source')
  .andThen(namespace => namespace.insert('doc1', data));
```
