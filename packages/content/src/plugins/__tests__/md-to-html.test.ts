import { describe, expect, it } from "vitest";
import mdToHtml from "../md-to-html.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

describe("mdToHtml plugin", () => {
	it("should convert markdown to html", async () => {
		const ctx = await createTestPluginContext();
		const namespaceResult = await ctx.data.createNamespace("test");
		const namespace = namespaceResult._unsafeUnwrap();
		await namespace.insert(
			"doc1",
			Promise.resolve({ content: "# Hello\n\nThis is **bold** and *italic*." }),
		);

		const plugin = mdToHtml({ path: "$.content" });
		await plugin.hooks.onContentFetchDone!(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).toBe(
			"<h1>Hello</h1>\n<p>This is <strong>bold</strong> and <em>italic</em>.</p>\n",
		);
	});

	it("should convert markdown to simplified html when simplified=true", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: "This is **bold** and *italic*." }));

		const plugin = mdToHtml({ path: "$.content", simplified: true });
		await plugin.hooks.onContentFetchDone!(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).toBe("This is <b>bold</b> and <i>italic</i>.");
	});

	it("should only transform specified keys", async () => {
		const ctx = await createTestPluginContext();
		const namespaceTest = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespaceTest.insert("doc1", Promise.resolve({ content: "# Hello" }));
		const namespaceSkip = (await ctx.data.createNamespace("skip"))._unsafeUnwrap();
		await namespaceSkip.insert("doc2", Promise.resolve({ content: "# Hello" }));

		const plugin = mdToHtml({ path: "$.content", keys: ["test"] });
		await plugin.hooks.onContentFetchDone!(ctx);

		const transformed = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		const skipped = await ctx.data.getDocument("skip", "doc2")._unsafeUnwrap()._read();

		expect((transformed as any).content).toBe("<h1>Hello</h1>\n");
		expect((skipped as any).content).toBe("# Hello");
	});

	it("should sanitize html in markdown content", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert(
			"doc1",
			Promise.resolve({ content: 'Hello <script>alert("xss")</script>' }),
		);

		const plugin = mdToHtml({ path: "$.content" });
		await plugin.hooks.onContentFetchDone!(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).not.toContain("<script>");
	});

	it("should throw error for non-string content", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: { foo: "bar" } }));

		const plugin = mdToHtml({ path: "$.content" });
		expect(plugin.hooks.onContentFetchDone!(ctx)).rejects.toThrow(
			"Error applying content transform",
		);
	});
});
