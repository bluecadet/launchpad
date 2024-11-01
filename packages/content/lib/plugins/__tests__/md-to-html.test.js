import { describe, it, expect } from 'vitest';
import mdToHtml from '../md-to-html.js';
import { createTestPluginContext } from './plugins.test-utils.js';

describe('mdToHtml plugin', () => {
	it('should convert markdown to html', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: '# Hello\n\nThis is **bold** and *italic*.' });

		const plugin = mdToHtml({ path: '$.content' });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).toBe('<h1>Hello</h1>\n<p>This is <strong>bold</strong> and <em>italic</em>.</p>\n');
	});

	it('should convert markdown to simplified html when simplified=true', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: 'This is **bold** and *italic*.' });

		const plugin = mdToHtml({ path: '$.content', simplified: true });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).toBe('This is <b>bold</b> and <i>italic</i>.');
	});

	it('should only transform specified keys', () => {
		const ctx = createTestPluginContext();
		ctx.data.createNamespace('skip');
		ctx.data.insert('test', 'doc1', { content: '# Hello' });
		ctx.data.insert('skip', 'doc2', { content: '# Hello' });

		const plugin = mdToHtml({ path: '$.content', keys: ['test'] });
		plugin.hooks.onContentFetchDone(ctx);

		const transformed = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		const skipped = ctx.data.get('skip', 'doc2')._unsafeUnwrap();

		expect(transformed.data.content).toBe('<h1>Hello</h1>\n');
		expect(skipped.data.content).toBe('# Hello');
	});

	it('should sanitize html in markdown content', () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: 'Hello <script>alert("xss")</script>' });

		const plugin = mdToHtml({ path: '$.content' });
		plugin.hooks.onContentFetchDone(ctx);

		const result = ctx.data.get('test', 'doc1')._unsafeUnwrap();
		expect(result.data.content).not.toContain('<script>');
	});

	it('should throw error for non-string content', async () => {
		const ctx = createTestPluginContext();
		ctx.data.insert('test', 'doc1', { content: { foo: 'bar' } });

		const plugin = mdToHtml({ path: '$.content' });
		expect(() => plugin.hooks.onContentFetchDone(ctx)).toThrow('Error applying content transform');
	});
});
