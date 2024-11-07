import { describe, expect, it } from "vitest";
import sanityToHtml from "../sanity-to-html.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

describe("sanityToHtml plugin", () => {
	const validBlock = {
		_type: "block",
		children: [
			{
				_type: "span",
				text: "Hello world",
			},
		],
	};

	it("should convert Sanity block to html", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: validBlock }));

		const plugin = sanityToHtml({ path: "$.content" });
		await plugin.hooks.onContentFetchDone(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).toBe("<p>Hello world</p>");
	});

	it("should only transform specified keys", async () => {
		const ctx = await createTestPluginContext();
		const testNamespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const skipNamespace = (await ctx.data.createNamespace("skip"))._unsafeUnwrap();
		await testNamespace.insert("doc1", Promise.resolve({ content: validBlock }));
		await skipNamespace.insert("doc2", Promise.resolve({ content: validBlock }));

		const plugin = sanityToHtml({ path: "$.content", keys: ["test"] });
		await plugin.hooks.onContentFetchDone(ctx);

		const transformed = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		const skipped = await ctx.data.getDocument("skip", "doc2")._unsafeUnwrap()._read();

		expect((transformed as any).content).toBe("<p>Hello world</p>");
		expect((skipped as any).content).toEqual(validBlock);
	});

	it("should throw error for invalid block content", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: "not a block" }));

		const plugin = sanityToHtml({ path: "$.content" });
		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow("Error applying content transform");
	});
});
