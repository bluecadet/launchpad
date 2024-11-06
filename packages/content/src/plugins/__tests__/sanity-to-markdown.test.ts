import { describe, it, expect } from 'vitest';
import sanityToMd from '../sanity-to-markdown.js';
import { createTestPluginContext } from './plugins.test-utils.js';

describe('sanityToMd plugin', () => {
	const validBlock = {
		_type: 'block',
		children: [
			{
				_type: 'span',
				text: 'Hello world'
			}
		]
	};

	it('should convert Sanity block to markdown', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: validBlock });

		const plugin = sanityToMd({ path: '$.content' });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect((result.data as Record<string, unknown>).content).toBe("Hello world");
	});

	it("should only transform specified keys", () => {
		const ctx = createTestPluginContext();
		ctx.data.createNamespace('skip');
		ctx.data.insert('test', 'doc1', { content: validBlock });
		ctx.data.insert('skip', 'doc2', { content: validBlock });

		const plugin = sanityToMd({ path: '$.content', keys: ['test'] });
		plugin.hooks.onContentFetchDone(ctx);

		const transformed = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		const skipped = ctx.data.get('skip', 'doc2')._unsafeUnwrap();

		expect((transformed.data as Record<string, unknown>).content).toBe("Hello world");
		expect((skipped.data as Record<string, unknown>).content).toEqual(validBlock);
	});

	it('should throw error for invalid block content', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: 'not a block' });

		const plugin = sanityToMd({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});
});
