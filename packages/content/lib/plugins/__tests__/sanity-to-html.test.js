import { describe, it, expect } from 'vitest';
import sanityToHtml from '../sanity-to-html.js';
import { createTestPluginContext } from './plugins.test-utils.js';

describe('sanityToHtml plugin', () => {
	const validBlock = {
		_type: 'block',
		children: [
			{
				_type: 'span',
				text: 'Hello world'
			}
		]
	};

	it('should convert Sanity block to html', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: validBlock });

		const plugin = sanityToHtml({ path: '$.content' });
		plugin.hooks.onContentFetchDone?.(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).toBe('<p>Hello world</p>');
	});

	it('should only transform specified keys', () => {
		const ctx = createTestPluginContext();
		ctx.data.createNamespace('skip');
		ctx.data.insert('test', 'doc1', { content: validBlock });
		ctx.data.insert('skip', 'doc2', { content: validBlock });

		const plugin = sanityToHtml({ path: '$.content', keys: ['test'] });
		plugin.hooks.onContentFetchDone(ctx);

		const transformed = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		const skipped = ctx.data.get('skip', 'doc2')._unsafeUnwrap();

		expect(transformed.data.content).toBe('<p>Hello world</p>');
		expect(skipped.data.content).toEqual(validBlock);
	});

	it('should throw error for invalid block content', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: 'not a block' });

		const plugin = sanityToHtml({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});
});
