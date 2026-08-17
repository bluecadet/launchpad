# DataStore

The DataStore is a file system-based storage system used to manage content during the fetch and transform process. It provides a simple API for storing and retrieving content, with support for namespaces and documents.

## Core Concepts

### Namespaces

Namespaces represent collections of documents from a single source. Each content source gets its own namespace, identified by the source's ID.

### Documents

Documents are individual files containing content data. They can be either single JSON files or batched files (for paginated content).

## API Reference

### DataStore

#### `createNamespace(namespaceId: string)`

Creates a new namespace in the data store. Returns a Result containing the namespace.

#### `namespace(namespaceId: string)`

Gets an existing namespace. Returns a Result containing the namespace.

#### `getDocument(namespaceId: string, documentId: string)`

Gets a specific document from a namespace. Returns a Result containing the document.

#### `filter(ids?: DataKeys)`

Filters documents based on namespace and document IDs. Returns grouped results by namespace.

### Namespace

#### `insert<T>(id: string, data: Promise<T> | AsyncIterable<T>)`

Inserts a new document into the namespace. Data can be a Promise for single documents or an AsyncIterable for batched documents.

#### `document(id: string)`

Gets a document by ID from the namespace.

#### `documents()`

Gets all documents in the namespace.

#### `waitFor(id: string)`

Returns a promise that resolves when the document with the passed ID has finished being written.

### Document

#### `update(cb: (data: T) => T | Promise<T>)`

Updates document content using a callback function.

#### `apply(pathExpression: string, fn: (x: unknown) => unknown)`

Applies a transformation to specific paths in the document using JSONPath.

#### `query(pathExpression: string)`

Queries document content using JSONPath expressions.

## Error Handling

The DataStore uses the `neverthrow` library for error handling. Most methods return a `Result` or `ResultAsync` type:

```typescript
const namespaceResult = dataStore.namespace('my-source');
if (namespaceResult.isErr()) {
  console.error('Error:', namespaceResult.error);
} else {
  const namespace = namespaceResult.value;
  // Use namespace...
}
```

For async operations, you can use the `andThen` method:

```typescript
await dataStore
  .createNamespace('my-source')
  .andThen(namespace => namespace.insert('doc1', data));
```
