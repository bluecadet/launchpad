import { describe, it, expect } from 'vitest';
import sanityToPlain from '../sanity-to-plain.js';
import { createTestPluginContext } from './plugins.test-utils.js';

describe('sanityToPlain plugin', () => {
	const validBlock = {
		_type: 'block',
		children: [
			{
				_type: 'span',
				text: 'Hello'
			},
			{
				_type: 'span',
				text: ' world'
			}
		]
	};

	it('should convert Sanity block to plain text', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: validBlock });

		const plugin = sanityToPlain({ path: '$.content' });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).toBe('Hello world');
	});

	it('should only transform specified keys', () => {
		const ctx = createTestPluginContext();
		ctx.data.createNamespace('skip');
		ctx.data.insert('test', 'doc1', { content: validBlock });
		ctx.data.insert('skip', 'doc2', { content: validBlock });

		const plugin = sanityToPlain({ path: '$.content', keys: ['test'] });
		plugin.hooks.onContentFetchDone(ctx);

		const transformed = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		const skipped = ctx.data.get('skip', 'doc2')._unsafeUnwrap();

		expect(transformed.data.content).toBe('Hello world');
		expect(skipped.data.content).toEqual(validBlock);
	});

	it('should throw error for invalid block content', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: 'not a block' });

		const plugin = sanityToPlain({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});

	it('should throw error for block without children', () => {
		const ctx = createTestPluginContext();
		const invalidBlock = {
			_type: 'block'
		};
		ctx.data.insert('test', 'doc1', { content: invalidBlock });

		const plugin = sanityToPlain({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});

	it('should throw error for block with invalid children', () => {
		const ctx = createTestPluginContext();
		const invalidBlock = {
			_type: 'block',
			children: [
				{
					_type: 'span'
					// missing text property
				}
			]
		};
		ctx.data.insert('test', 'doc1', { content: invalidBlock });

		const plugin = sanityToPlain({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});

	it('should concatenate multiple text spans', () => {
		const ctx = createTestPluginContext();
		const blockWithMultipleSpans = {
			_type: 'block',
			children: [
				{
					_type: 'span',
					text: 'Hello'
				},
				{
					_type: 'span',
					text: ' beautiful'
				},
				{
					_type: 'span',
					text: ' world'
				}
			]
		};
		ctx.data.insert('test', 'doc1', { content: blockWithMultipleSpans });

		const plugin = sanityToPlain({ path: '$.content' });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).toBe('Hello beautiful world');
	});
});
