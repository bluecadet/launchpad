import { describe, expect, it } from "vitest";
import sanityToPlain from "../sanity-to-plain.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

describe("sanityToPlain plugin", () => {
	const validBlock = {
		_type: "block",
		children: [
			{
				_type: "span",
				text: "Hello",
			},
			{
				_type: "span",
				text: " world",
			},
		],
	};

	it("should convert Sanity block to plain text", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: validBlock }));

		const transform = sanityToPlain({ path: "$.content" });
		await transform.apply(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).toBe("Hello world");
	});

	it("should only transform specified keys", async () => {
		const ctx = await createTestPluginContext();
		const testNamespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const skipNamespace = (await ctx.data.createNamespace("skip"))._unsafeUnwrap();
		await testNamespace.insert("doc1", Promise.resolve({ content: validBlock }));
		await skipNamespace.insert("doc2", Promise.resolve({ content: validBlock }));

		const transform = sanityToPlain({ path: "$.content", keys: ["test"] });
		await transform.apply(ctx);

		const transformed = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		const skipped = await ctx.data.getDocument("skip", "doc2")._unsafeUnwrap()._read();

		expect((transformed as any).content).toBe("Hello world");
		expect((skipped as any).content).toEqual(validBlock);
	});

	it("should throw error for invalid block content", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ content: "not a block" }));

		const transform = sanityToPlain({ path: "$.content" });
		await expect(transform.apply(ctx)).rejects.toThrow("Error applying content transform");
	});

	it("should throw error for block without children", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const invalidBlock = {
			_type: "block",
		};
		await namespace.insert("doc1", Promise.resolve({ content: invalidBlock }));

		const transform = sanityToPlain({ path: "$.content" });
		await expect(transform.apply(ctx)).rejects.toThrow("Error applying content transform");
	});

	it("should throw error for block with invalid children", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const invalidBlock = {
			_type: "block",
			children: [
				{
					_type: "span",
					// missing text property
				},
			],
		};
		await namespace.insert("doc1", Promise.resolve({ content: invalidBlock }));

		const transform = sanityToPlain({ path: "$.content" });
		await expect(transform.apply(ctx)).rejects.toThrow("Error applying content transform");
	});

	it("should concatenate multiple text spans", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const blockWithMultipleSpans = {
			_type: "block",
			children: [
				{
					_type: "span",
					text: "Hello",
				},
				{
					_type: "span",
					text: " beautiful",
				},
				{
					_type: "span",
					text: " world",
				},
			],
		};
		await namespace.insert("doc1", Promise.resolve({ content: blockWithMultipleSpans }));

		const transform = sanityToPlain({ path: "$.content" });
		await transform.apply(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).content).toBe("Hello beautiful world");
	});
});
