import path from "node:path";
import { vol } from "memfs";
import type Sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "../sharp.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

const testImage = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

describe("sharp", () => {
	beforeEach(() => vol.reset());
	afterEach(() => vol.reset());

	describe("plugin integration", () => {
		it("should transform images and maintain cache", async () => {
			// Set up test files
			vol.mkdirSync("/download/test", { recursive: true });
			vol.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["image.jpg"],
				}),
			);

			const plugin = sharp({
				buildTransform: (transform: Sharp.Sharp) => transform.resize(100, 100),
				updateURLs: true,
			});

			// First run - should transform image
			await plugin.hooks.onContentFetchDone!(ctx);

			// Check transformed file exists
			const transformedPath = "/download/test/image@100x100-crop.jpg";
			expect(vol.existsSync(transformedPath)).toBe(true);

			// Check data is updated
			const updatedDoc = await namespace.document("doc1")._unsafeUnwrap()._read();
			expect((updatedDoc as any).images[0]).toBe("image@100x100-crop.jpg");
		});

		it("should handle multiple transforms on same image", async () => {
			vol.mkdirSync("/download/test", { recursive: true });
			vol.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					image: "image.jpg",
				}),
			);

			// First transform - resize
			await sharp({
				buildTransform: (t) => t.resize(100, 100),
				updateURLs: false,
			}).hooks.onContentFetchDone!(ctx);

			// Second transform - grayscale
			await sharp({
				buildTransform: (t) => t.grayscale(),
				updateURLs: false,
			}).hooks.onContentFetchDone!(ctx);

			expect(vol.existsSync("/download/test/image@100x100-crop.jpg")).toBe(true);
			expect(vol.existsSync("/download/test/image@greyscale.jpg")).toBe(true);
		});

		it("should error if source image doesn't exist", async () => {
			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					image: "nonexistent.jpg",
				}),
			);

			const plugin = sharp({
				buildTransform: (t) => t.resize(100, 100),
			});

			await expect(plugin.hooks.onContentFetchDone!(ctx)).rejects.toThrow(
				`Input file '${path.resolve("/download/test/nonexistent.jpg")}' does not exist`,
			);
		});

		it("should respect custom mediaPattern", async () => {
			vol.mkdirSync("/download/test", { recursive: true });
			vol.writeFileSync("/download/test/image.png", testImage);
			vol.writeFileSync("/download/test/image.jpg", testImage);

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["image.png", "image.jpg"],
				}),
			);

			const plugin = sharp({
				mediaPattern: /\.png$/,
				buildTransform: (t) => t.resize(100, 100),
			});

			await plugin.hooks.onContentFetchDone!(ctx);

			expect(vol.existsSync("/download/test/image@100x100-crop.png")).toBe(true);
			expect(vol.existsSync("/download/test/image@100x100-crop.jpg")).toBe(false);
		});
	});
});
