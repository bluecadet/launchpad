import path from "node:path";
import { vol } from "memfs";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { type ArtifactCache, createArtifactCache } from "../../cache/artifact-cache.js";
import mediaDownloader, {
	findMediaUrls,
	localFilePathFromUrl,
	mediaDownloaderConfigSchema,
} from "../media-downloader.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

function getMediaDownloaderConfig(config: z.input<typeof mediaDownloaderConfigSchema>) {
	return mediaDownloaderConfigSchema.parse(config);
}

describe("mediaDownloader", () => {
	const server = setupServer();
	const caches: ArtifactCache[] = [];
	async function createMediaContext() {
		const ctx = await createTestPluginContext();
		const cache = await createArtifactCache({
			databasePath: ":memory:",
			previousRoot: ctx.paths.getBackupPath,
			stagedRoot: ctx.paths.getDownloadPath,
		});
		// memfs closes FileHandle read streams even with autoClose:false; real-byte
		// capture and reuse are covered by the real-filesystem HTTP cache tests.
		vi.spyOn(cache, "storeHttp").mockResolvedValue(undefined);
		caches.push(cache);
		return { ...ctx, cache };
	}

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterAll(() => server.close());
	beforeEach(() => vol.reset());
	afterEach(async () => {
		server.resetHandlers();
		for (const cache of caches.splice(0)) await cache.close();
	});

	describe("localFilePathFromUrl", () => {
		it("should strip protocol and domain", () => {
			expect(localFilePathFromUrl("https://example.com/path/to/file.jpg")).toBe(
				`path${path.sep}to${path.sep}file.jpg`,
			);
		});

		it("should handle URLs without leading slash", () => {
			expect(localFilePathFromUrl("https://example.com/file.jpg")).toBe("file.jpg");
		});

		it("should handle URLs with query params", () => {
			expect(localFilePathFromUrl("https://example.com/path/file.jpg?size=large")).toBe(
				`path${path.sep}file.jpg?size=large`,
			);
		});
	});

	describe("configuration", () => {
		it.each(["enableIfModifiedSinceCheck", "enableContentLengthCheck"])(
			"rejects removed %s configuration at runtime",
			(option) => {
				expect(() => mediaDownloader({ [option]: false })).toThrow(`${option} has been removed`);
			},
		);
	});

	describe("findMediaUrls", () => {
		it("should find URLs using mediaPattern", async () => {
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: [
						"https://example.com/1.jpg",
						"https://example.com/1.jpg",
						"https://example.com/2.png",
						"not-a-url.txt",
						"https://example.com/doc.pdf",
					],
				}),
			);

			const urls = await findMediaUrls(
				ctx.data,
				getMediaDownloaderConfig({ mediaPattern: /\.(jpg|png)$/i }),
				"",
				["$..*[?(@.match(/\\.(jpg|png)$/i))]"],
			);

			expect(urls).toMatchObject([
				{ url: "https://example.com/1.jpg", sourceId: "test" },
				{ url: "https://example.com/2.png", sourceId: "test" },
			]);
		});

		it("should find URLs using matchPath", async () => {
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					media: {
						hero: "https://example.com/hero.jpg",
						gallery: [{ url: "https://example.com/1.jpg" }, { url: "https://example.com/2.jpg" }],
					},
				}),
			);

			const urls = await findMediaUrls(
				ctx.data,
				getMediaDownloaderConfig({ matchPath: "$..*[?(@.url)].url" }),
				"",
				["$..*[?(@.url)].url"],
			);

			expect(urls).toMatchObject([
				{ url: "https://example.com/1.jpg", sourceId: "test" },
				{ url: "https://example.com/2.jpg", sourceId: "test" },
			]);
		});

		it("should support multiple query paths", async () => {
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					media: {
						hero: "https://example.com/hero.jpg",
						gallery: [{ url: "https://example.com/1.jpg" }, { url: "https://example.com/2.jpg" }],
					},
					images: ["https://example.com/3.jpg", "https://example.com/4.png"],
				}),
			);

			const urls = await findMediaUrls(
				ctx.data,
				getMediaDownloaderConfig({
					matchPath: ["$..*[?(@.url)].url", "$..images[*]"],
				}),
				"",
				["$..*[?(@.url)].url", "$..images[*]"],
			);

			expect(urls).toMatchObject([
				{ url: "https://example.com/1.jpg", sourceId: "test" },
				{ url: "https://example.com/2.jpg", sourceId: "test" },
				{ url: "https://example.com/3.jpg", sourceId: "test" },
				{ url: "https://example.com/4.png", sourceId: "test" },
			]);
		});

		it("should update document paths when updatePaths is true", async () => {
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					media: {
						hero: "https://example.com/hero.jpg",
						gallery: [{ url: "https://example.com/1.jpg" }, { url: "https://example.com/2.jpg" }],
					},
				}),
			);

			await findMediaUrls(
				ctx.data,
				getMediaDownloaderConfig({ matchPath: "$..*[?(@.url)].url", updatePaths: false }),
				"",
				["$..*[?(@.url)].url"],
			);

			// Verify original data was modified to use relative paths
			expect(await namespace.document("doc1")._unsafeUnwrap()._read()).toEqual({
				media: {
					hero: "https://example.com/hero.jpg",
					gallery: [{ url: "https://example.com/1.jpg" }, { url: "https://example.com/2.jpg" }],
				},
			});

			await findMediaUrls(
				ctx.data,
				getMediaDownloaderConfig({ matchPath: "$..*[?(@.url)].url", updatePaths: true }),
				"",
				["$..*[?(@.url)].url"],
			);

			// Verify original data was modified to use relative paths
			expect(await namespace.document("doc1")._unsafeUnwrap()._read()).toEqual({
				media: {
					hero: "https://example.com/hero.jpg",
					gallery: [{ url: "1.jpg" }, { url: "2.jpg" }],
				},
			});
		});
	});

	describe("plugin integration", () => {
		it("should download all matching files", async () => {
			server.use(
				http.get(/https?:\/\/example\.com\/.*/i, () => {
					return new HttpResponse("media content", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
					nested: {
						image: "https://example.com/3.jpg",
					},
				}),
			);

			const transform = mediaDownloader({
				maxConcurrent: 2,
				mediaPattern: /\.jpg$/i,
			});

			await transform.apply(ctx);

			// Check all files were downloaded
			const expectedFiles = ["1.jpg", "2.jpg", "3.jpg"];
			for (const file of expectedFiles) {
				const filePath = path.resolve(ctx.paths.getDownloadPath(), "test", file);
				expect(vol.existsSync(filePath)).toBe(true);
				expect(vol.readFileSync(filePath, "utf8")).toBe("media content");
			}
		});

		it.each([200, 404])(
			"does not access transform temp files during an ordinary download (HTTP %s)",
			async (status) => {
				server.use(
					http.get("https://example.com/image.jpg", () => new HttpResponse("body", { status })),
				);
				const ctx = await createMediaContext();
				const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
				await namespace.insert("doc", Promise.resolve({ image: "https://example.com/image.jpg" }));
				const tempRoot = ctx.paths.getTempPath();
				vol.mkdirSync(tempRoot, { recursive: true });
				vol.writeFileSync(path.join(tempRoot, "orphan"), "unrelated temporary file");
				const tempPath = vi.spyOn(ctx.paths, "getTempPath").mockImplementation(() => {
					throw new Error("The downloader must not access its unused transform temp tree");
				});
				tempPath.mockClear();
				const execution = mediaDownloader().apply(ctx);
				if (status === 200) await execution;
				else await expect(execution).rejects.toThrow("Queue encountered");
				expect(tempPath).not.toHaveBeenCalled();
				expect(vol.readFileSync(path.join(tempRoot, "orphan"), "utf8")).toBe(
					"unrelated temporary file",
				);
			},
		);

		it("forceClearTempFiles clears only transform temp staging and still consults HTTP metadata", async () => {
			server.use(http.get("https://example.com/image.jpg", () => new HttpResponse("new body")));
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert("doc", Promise.resolve({ image: "https://example.com/image.jpg" }));
			vol.mkdirSync(ctx.paths.getTempPath(), { recursive: true });
			vol.writeFileSync(path.join(ctx.paths.getTempPath(), "orphan"), "temporary");
			vol.mkdirSync(ctx.paths.getBackupPath("test"), { recursive: true });
			vol.writeFileSync(path.join(ctx.paths.getBackupPath("test"), "image.jpg"), "published");
			const lookup = vi.spyOn(ctx.cache, "lookupHttp");
			const tempRoot = ctx.paths.getTempPath();
			const tempPath = vi.spyOn(ctx.paths, "getTempPath").mockClear();
			await mediaDownloader({ forceClearTempFiles: true }).apply(ctx);
			expect(lookup).toHaveBeenCalled();
			expect(tempPath).toHaveBeenCalledTimes(1);
			expect(vol.existsSync(tempRoot)).toBe(false);
			expect(
				vol.readFileSync(path.join(ctx.paths.getBackupPath("test"), "image.jpg"), "utf8"),
			).toBe("published");
		});

		it("waits for active downloads to settle before rejecting a failed queue", async () => {
			let releaseSlow: () => void = () => {};
			let reportError: () => void = () => {};
			const slowGate = new Promise<void>((resolve) => {
				releaseSlow = resolve;
			});
			const errorSeen = new Promise<void>((resolve) => {
				reportError = resolve;
			});
			server.use(
				http.get("https://example.com/slow.jpg", async () => {
					await slowGate;
					return new HttpResponse("slow body");
				}),
				http.get("https://example.com/error.jpg", () => {
					reportError();
					return new HttpResponse(null, { status: 404 });
				}),
			);
			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc",
				Promise.resolve({
					images: ["https://example.com/slow.jpg", "https://example.com/error.jpg"],
				}),
			);
			let settled = false;
			const execution = mediaDownloader({ maxConcurrent: 2 })
				.apply(ctx)
				.finally(() => {
					settled = true;
				});
			await errorSeen;
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(settled).toBe(false);
			releaseSlow();
			await expect(execution).rejects.toThrow("Queue encountered");
			expect(
				vol.readFileSync(path.join(ctx.paths.getDownloadPath("test"), "slow.jpg"), "utf8"),
			).toBe("slow body");
		});

		it("should handle errors based on abortOnError setting", async () => {
			server.use(
				http.get("https://example.com/success.jpg", () => {
					return new HttpResponse("success");
				}),
				http.get("https://example.com/error.jpg", () => {
					return new HttpResponse(null, { status: 500 });
				}),
			);

			const ctx = await createMediaContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["https://example.com/success.jpg", "https://example.com/error.jpg"],
				}),
			);

			const transform = mediaDownloader({
				abortOnError: false,
				mediaPattern: /\.jpg$/i,
			});

			await transform.apply(ctx);

			// Success file should exist
			const successPath = path.resolve(ctx.paths.getDownloadPath(), "test", "success.jpg");
			expect(vol.existsSync(successPath)).toBe(true);

			// Error file should not exist
			const errorPath = path.resolve(ctx.paths.getDownloadPath(), "test", "error.jpg");
			expect(vol.existsSync(errorPath)).toBe(false);
		});
	});
});
