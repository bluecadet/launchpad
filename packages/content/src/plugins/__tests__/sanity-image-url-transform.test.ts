import { describe, expect, it } from "vitest";
import sanityImageUrlTransform from "../sanity-image-url-transform.js";
import { createTestPluginContext } from "./plugins.test-utils.js";
import type { ImageUrlBuilder } from "@sanity/image-url/lib/types/builder.js";

const TEST_ID = "image-Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000-jpg";
const TEST_PROJECT_ID = "test-project";
const TEST_DATASET = "production";
const BASE_TRANSFORMED_URL = `https://cdn.sanity.io/images/${TEST_PROJECT_ID}/${TEST_DATASET}/Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000.jpg`;

describe("sanityImageUrlTransform plugin", () => {
	const validImageReference = {
		_type: "image",
		_ref: TEST_ID,
	};

	const validImageAsset = {
		_type: "image",
		_id: TEST_ID,
	};

	const validImageObject = {
		_type: "image",
		asset: {
			_ref: TEST_ID,
		},
	};

	const validImageWithAssetStub = {
		_type: "image",
		asset: {
			url: BASE_TRANSFORMED_URL,
		},
	};

	it("should transform image reference to URL", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert(
			"doc1",
			Promise.resolve({ someContent: { image: validImageReference } }),
		);

		const plugin = sanityImageUrlTransform({
			projectId: "test-project",
			buildUrl: (builder: ImageUrlBuilder) => builder.width(100),
		});

		await plugin.hooks.onContentFetchDone(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();

		const expected = `${BASE_TRANSFORMED_URL}?w=100`;

		expect((result as any).someContent.image.transformedUrl).toMatch(expected);
	});

	it("should transform image asset to URL", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ someContent: { image: validImageAsset } }));

		const plugin = sanityImageUrlTransform({
			projectId: "test-project",
			buildUrl: (builder: ImageUrlBuilder) => builder.width(100),
		});

		await plugin.hooks.onContentFetchDone(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		const expected = `${BASE_TRANSFORMED_URL}?w=100`;

		expect((result as any).someContent.image.transformedUrl).toMatch(expected);
	});

	it("should only transform specified namespace keys", async () => {
		const ctx = await createTestPluginContext();
		const testNamespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		const skipNamespace = (await ctx.data.createNamespace("skip"))._unsafeUnwrap();

		await testNamespace.insert(
			"doc1",
			Promise.resolve({ someContent: { image: validImageObject } }),
		);
		await skipNamespace.insert(
			"doc2",
			Promise.resolve({ someContent: { image: validImageObject } }),
		);

		const plugin = sanityImageUrlTransform({
			projectId: "test-project",
			keys: ["test"],
			buildUrl: (builder: ImageUrlBuilder) => builder.width(100),
		});

		await plugin.hooks.onContentFetchDone(ctx);

		const transformed = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		const skipped = await ctx.data.getDocument("skip", "doc2")._unsafeUnwrap()._read();

		expect((transformed as any).someContent.image.transformedUrl).toBeDefined();
		expect((skipped as any).someContent.image.transformedUrl).toBeUndefined();
	});

	it("should use custom property name for transformed URL", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert(
			"doc1",
			Promise.resolve({ someContent: { image: validImageWithAssetStub } }),
		);

		const plugin = sanityImageUrlTransform({
			projectId: "test-project",
			newProperty: "cdnUrl",
			buildUrl: (builder: ImageUrlBuilder) => builder.width(100),
		});

		await plugin.hooks.onContentFetchDone(ctx);

		const result = await ctx.data.getDocument("test", "doc1")._unsafeUnwrap()._read();
		expect((result as any).someContent.image.cdnUrl).toBeDefined();
		expect((result as any).someContent.image.transformedUrl).toBeUndefined();
	});

	it("should throw error for invalid image object", async () => {
		const ctx = await createTestPluginContext();
		const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc1", Promise.resolve({ someContent: { image: { _type: "image" } } }));

		const plugin = sanityImageUrlTransform({
			projectId: "test-project",
			buildUrl: (builder: ImageUrlBuilder) => builder.width(100),
		});

		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow(
			"Error applying content transform to document doc1",
		);
	});
});
