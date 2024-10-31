import { describe, it, expect } from 'vitest';
import { getMatchingDocuments, applyTransformToFiles, isBlockContent } from '../content-transform-utils.js';
import { DataStore } from '../data-store.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

describe('content-transform-utils', () => {
	describe('getMatchingDocuments', () => {
		it('should return all documents when ids are not provided', () => {
			const dataStore = new DataStore();
			dataStore.createNamespace('test');
			dataStore.insert('test', 'doc1', { content: 'test1' });
			dataStore.insert('test', 'doc2', { content: 'test2' });

			const result = getMatchingDocuments(dataStore);
			expect(result).toBeOk();
			expect(Array.from(result._unsafeUnwrap()).length).toBe(2);
		});

		it('should return filtered documents when ids are provided', () => {
			const dataStore = new DataStore();
			dataStore.createNamespace('test1');
			dataStore.createNamespace('test2');
			dataStore.insert('test1', 'doc1', { content: 'test1' });
			dataStore.insert('test2', 'doc2', { content: 'test2' });

			const result = getMatchingDocuments(dataStore, ['test1']);
			expect(result).toBeOk();
			expect(Array.from(result._unsafeUnwrap()).length).toBe(1);
			expect(Array.from(result._unsafeUnwrap())[0].id).toBe('doc1');
		});
	});

	describe('applyTransformToFiles', () => {
		it('should apply transform to matching documents', () => {
			const dataStore = new DataStore();
			dataStore.createNamespace('test');
			dataStore.insert('test', 'doc1', { content: 'test' });

			const logger = createMockLogger();
			const transformFn = (/** @type {unknown} */ content) => (typeof content === 'string' ? content.toUpperCase() : content);

			applyTransformToFiles({
				dataStore,
				path: '$.content',
				transformFn,
				logger,
				keys: ['test']
			});

			expect(dataStore.get('test', 'doc1')._unsafeUnwrap().data.content).toBe('TEST');
			expect(logger.debug).toHaveBeenCalled();
		});

		it('should return error if document.apply fails', () => {
			const dataStore = new DataStore();
			dataStore.createNamespace('test');
			dataStore.insert('test', 'doc1', { content: 'test' });

			const logger = createMockLogger();
			const transformFn = () => { throw new Error('Transform error'); };

			expect(() => applyTransformToFiles({
				dataStore,
				path: '$.content',
				transformFn,
				logger,
				keys: ['test']
			})).toThrow(/Error applying content transform/);
		});
	});

	describe('isBlockContent', () => {
		it('should return true for valid block content', () => {
			const content = { _type: 'block' };
			expect(isBlockContent(content)).toBe(true);
		});

		it('should return false for non-object content', () => {
			expect(isBlockContent('not an object')).toBe(false);
			expect(isBlockContent(null)).toBe(false);
		});

		it('should return false for object without _type property', () => {
			const content = { notType: 'block' };
			expect(isBlockContent(content)).toBe(false);
		});

		it('should return false for object with _type not equal to "block"', () => {
			const content = { _type: 'not-block' };
			expect(isBlockContent(content)).toBe(false);
		});
	});
});
