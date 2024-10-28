import { describe, it, expect } from 'vitest';
import { DataStore, Document } from '../data-store.js';

describe('Document', () => {
	it('should create a document with id and data', () => {
		const doc = new Document('test-id', { content: 'test content' });
		expect(doc.id).toBe('test-id');
		expect(doc.data).toEqual({ content: 'test content' });
	});

	it('should update document data', () => {
		const doc = new Document('test-id', { content: 'test content' });
		doc.update({ content: 'updated content' });
		expect(doc.data).toEqual({ content: 'updated content' });
	});

	it('should apply transformation to document data', () => {
		const doc = new Document('test-id', { content: 'test content' });
		const result = doc.apply('$.content', (value) => typeof value === 'string' ? value.toUpperCase() : value);
		expect(result.isOk()).toBe(true);
		expect(doc.data).toEqual({ content: 'TEST CONTENT' });
	});

	it('should handle errors in apply transformation', () => {
		const doc = new Document('test-id', { content: 'test content' });
		const result = doc.apply('$.content', () => {
			throw new Error('Test error');
		});
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe('Test error');
	});
});

describe('DataStore', () => {
	it('should create a namespace', () => {
		const store = new DataStore();
		const result = store.createNamespace('test-namespace');
		expect(result.isOk()).toBe(true);
	});

	it('should not create a duplicate namespace', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		const result = store.createNamespace('test-namespace');
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe('Namespace test-namespace already exists in data store');
	});

	it('should insert a document into a namespace', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		const result = store.insert('test-namespace', 'test-doc', { content: 'test content' });
		expect(result.isOk()).toBe(true);
	});

	it('should not insert a duplicate document', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		store.insert('test-namespace', 'test-doc', { content: 'test content' });
		const result = store.insert('test-namespace', 'test-doc', { content: 'duplicate content' });
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe('Document test-doc already exists in namespace test-namespace');
	});

	it('should get a document from a namespace', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		store.insert('test-namespace', 'test-doc', { content: 'test content' });
		const result = store.get('test-namespace', 'test-doc');
		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().data).toEqual({ content: 'test content' });
	});

	it('should return error when getting non-existent document', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		const result = store.get('test-namespace', 'non-existent-doc');
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe('Document non-existent-doc not found in namespace test-namespace');
	});

	it('should delete a document from a namespace', () => {
		const store = new DataStore();
		store.createNamespace('test-namespace');
		store.insert('test-namespace', 'test-doc', { content: 'test content' });
		const deleteResult = store.delete('test-namespace', 'test-doc');
		expect(deleteResult.isOk()).toBe(true);
		const getResult = store.get('test-namespace', 'test-doc');
		expect(getResult.isErr()).toBe(true);
	});

	it('should create a namespace from a map', () => {
		const store = new DataStore();
		const map = new Map([
			['doc1', { content: 'content 1' }],
			['doc2', { content: 'content 2' }]
		]);
		const result = store.createNamespaceFromMap('test-namespace', map);
		expect(result.isOk()).toBe(true);
		const doc1Result = store.get('test-namespace', 'doc1');
		expect(doc1Result.isOk()).toBe(true);
		expect(doc1Result._unsafeUnwrap().data).toEqual({ content: 'content 1' });
	});

	it('should filter documents', () => {
		const store = new DataStore();
		store.createNamespace('namespace1');
		store.createNamespace('namespace2');
		store.insert('namespace1', 'doc1', { content: 'content 1' });
		store.insert('namespace1', 'doc2', { content: 'content 2' });
		store.insert('namespace2', 'doc3', { content: 'content 3' });

		const result = store.filter(['namespace1', ['namespace2', 'doc3']]);
		expect(result.isOk()).toBe(true);
		const filteredDocs = result._unsafeUnwrap();
		expect(filteredDocs).toHaveLength(2);
		expect(filteredDocs[0].namespaceId).toBe('namespace1');
		expect(filteredDocs[0].documents).toHaveLength(2);
		expect(filteredDocs[1].namespaceId).toBe('namespace2');
		expect(filteredDocs[1].documents).toHaveLength(1);
		expect(filteredDocs[1].documents[0].id).toBe('doc3');
	});

	it('should return all documents when filter is not provided', () => {
		const store = new DataStore();
		store.createNamespace('namespace1');
		store.createNamespace('namespace2');
		store.insert('namespace1', 'doc1', { content: 'content 1' });
		store.insert('namespace2', 'doc2', { content: 'content 2' });

		const result = store.filter();
		expect(result.isOk()).toBe(true);
		const allDocs = result._unsafeUnwrap();
		expect(allDocs).toHaveLength(2);
		expect(allDocs.flatMap(ns => ns.documents)).toHaveLength(2);
	});
});
