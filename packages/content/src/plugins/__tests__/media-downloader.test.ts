import path from "node:path";
import { vol } from "memfs";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import mediaDownloader, {
	localFilePathFromUrl,
	checkCacheStatus,
	downloadFile,
	findMediaUrls,
	mediaDownloaderConfigSchema,
} from "../media-downloader.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

function getMediaDownloaderConfig(config: z.input<typeof mediaDownloaderConfigSchema>) {
	return mediaDownloaderConfigSchema.parse(config);
}

describe("mediaDownloader", () => {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterAll(() => server.close());
	beforeEach(() => vol.reset());
	afterEach(() => server.resetHandlers());

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

	describe("checkCacheStatus", () => {
		it("should indicate download needed when file does not exist", async () => {
			const result = await checkCacheStatus(
				"https://example.com/new.jpg",
				"/downloads/new.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({
					enableIfModifiedSinceCheck: true,
					enableContentLengthCheck: true,
				}),
			);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap().shouldDownload).toBe(true);
		});

		it("should check modified date when file exists", async () => {
			// Setup existing file
			vol.mkdirSync("/downloads", { recursive: true });
			vol.writeFileSync("/downloads/cached.jpg", "existing data");

			server.use(
				http.head("https://example.com/cached.jpg", ({ request }) => {
					const ifModifiedSince = request.headers.get("If-Modified-Since");
					return new HttpResponse(null, {
						status: ifModifiedSince ? 304 : 200,
					});
				}),
			);

			const result = await checkCacheStatus(
				"https://example.com/cached.jpg",
				"/downloads/cached.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({
					enableIfModifiedSinceCheck: true,
					enableContentLengthCheck: false,
				}),
			);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap().shouldDownload).toBe(false);
		});

		it("should check content length when enabled", async () => {
			// Setup existing file with known size
			vol.mkdirSync("/downloads", { recursive: true });
			vol.writeFileSync("/downloads/size.jpg", "data");

			server.use(
				http.head("https://example.com/size.jpg", () => {
					return new HttpResponse(null, {
						headers: {
							"Content-Length": "10", // Different from actual file size
						},
					});
				}),
				http.head("https://example.com/size-match.jpg", () => {
					return new HttpResponse(null, {
						headers: {
							"Content-Length": "4", // Matches file size
						},
					});
				}),
			);

			// Test different content length
			const differentResult = await checkCacheStatus(
				"https://example.com/size.jpg",
				"/downloads/size.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({
					enableIfModifiedSinceCheck: false,
					enableContentLengthCheck: true,
				}),
			);

			expect(differentResult).toBeOk();
			expect(differentResult._unsafeUnwrap().shouldDownload).toBe(true);

			// Test matching content length
			vol.writeFileSync("/downloads/size-match.jpg", "data");
			const matchingResult = await checkCacheStatus(
				"https://example.com/size-match.jpg",
				"/downloads/size-match.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({
					enableIfModifiedSinceCheck: false,
					enableContentLengthCheck: true,
				}),
			);

			expect(matchingResult).toBeOk();
			expect(matchingResult._unsafeUnwrap().shouldDownload).toBe(false);
		});
	});

	describe("downloadFile", () => {
		it("should download and save file", async () => {
			server.use(
				http.get("https://example.com/test.jpg", () => {
					return new HttpResponse("image data", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			vol.mkdirSync("/downloads", { recursive: true });

			const result = await downloadFile(
				"https://example.com/test.jpg",
				"/downloads/test.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({ maxTimeout: 1000 }),
			);

			expect(result).toBeOk();
			expect(vol.readFileSync("/downloads/test.jpg", "utf8")).toBe("image data");
		});

		it("should handle network errors", async () => {
			server.use(
				http.get("https://example.com/error.jpg", () => {
					return new HttpResponse(null, { status: 404 });
				}),
			);

			const result = await downloadFile(
				"https://example.com/error.jpg",
				"/downloads/error.jpg",
				new AbortController().signal,
				getMediaDownloaderConfig({ maxTimeout: 1000 }),
			);

			expect(result).toBeErr();
			const error = result._unsafeUnwrapErr();
			expect(error.name).toBe("NetworkError");
		});
	});

	describe("findMediaUrls", () => {
		it("should find URLs using mediaPattern", async () => {
			const ctx = await createTestPluginContext();
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
				"$..*[?(@.match(/\\.(jpg|png)$/i))]",
			);

			expect(urls).toMatchObject([
				{ url: "https://example.com/1.jpg", sourceId: "test" },
				{ url: "https://example.com/2.png", sourceId: "test" },
			]);
		});

		it("should find URLs using matchPath", async () => {
			const ctx = await createTestPluginContext();
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
				"$..*[?(@.url)].url",
			);

			expect(urls).toMatchObject([
				{ url: "https://example.com/1.jpg", sourceId: "test" },
				{ url: "https://example.com/2.jpg", sourceId: "test" },
			]);
		});

		it("should update document paths when updatePaths is true", async () => {
			const ctx = await createTestPluginContext();
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
				"$..*[?(@.url)].url",
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
				"$..*[?(@.url)].url",
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

			const ctx = await createTestPluginContext();
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

			const plugin = mediaDownloader({
				maxConcurrent: 2,
				mediaPattern: /\.jpg$/i,
			});

			await plugin.hooks.onContentFetchDone!(ctx);

			// Check all files were downloaded
			const expectedFiles = ["1.jpg", "2.jpg", "3.jpg"];
			for (const file of expectedFiles) {
				const filePath = path.join(ctx.paths.getDownloadPath(), "test", file);
				expect(vol.existsSync(filePath)).toBe(true);
				expect(vol.readFileSync(filePath, "utf8")).toBe("media content");
			}
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

			const ctx = await createTestPluginContext();
			const namespace = (await ctx.data.createNamespace("test"))._unsafeUnwrap();
			await namespace.insert(
				"doc1",
				Promise.resolve({
					images: ["https://example.com/success.jpg", "https://example.com/error.jpg"],
				}),
			);

			const plugin = mediaDownloader({
				abortOnError: false,
				mediaPattern: /\.jpg$/i,
			});

			await plugin.hooks.onContentFetchDone!(ctx);

			// Success file should exist
			const successPath = path.join(ctx.paths.getDownloadPath(), "test", "success.jpg");
			expect(vol.existsSync(successPath)).toBe(true);

			// Error file should not exist
			const errorPath = path.join(ctx.paths.getDownloadPath(), "test", "error.jpg");
			expect(vol.existsSync(errorPath)).toBe(false);
		});
	});
});
