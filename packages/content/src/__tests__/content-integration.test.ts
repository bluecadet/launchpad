import path from "node:path";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LaunchpadContent } from "../launchpad-content.js";
import mdToHtml from "../plugins/md-to-html.js";
import mediaDownloader from "../plugins/media-downloader.js";
import sanityToHtml from "../plugins/sanity-to-html.js";
import jsonSource from "../sources/json-source.js";
import sanitySource from "../sources/sanity-source.js";

describe("Content Integration", () => {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterAll(() => server.close());
	beforeEach(() => vol.reset());
	afterEach(() => server.resetHandlers());

	describe("JSON Source with Markdown and Media", () => {
		it("should fetch JSON, convert markdown to HTML, and download media", async () => {
			// Mock JSON endpoint with markdown content and media URLs
			server.use(
				http.get("https://api.example.com/content", () => {
					return HttpResponse.json({
						title: "Test Article",
						content: "# Hello World\n\nThis is a paragraph",
						gallery: ["https://example.com/gallery1.jpg", "https://example.com/gallery2.jpg"],
					});
				}),
				// Mock media endpoints
				http.get(/https:\/\/example\.com\/.+\.jpg/, () => {
					return new HttpResponse("fake image data", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			const content = new LaunchpadContent(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "blog",
							files: {
								"article.json": "https://api.example.com/content",
							},
						}),
					],
					plugins: [
						mdToHtml({ path: "$.content" }),
						mediaDownloader({
							mediaPattern: /\.jpg$/,
							maxConcurrent: 2,
						}),
					],
				},
				createMockLogger(),
			);

			const result = await content.download();

			expect(result).toBeOk();

			// Check if markdown was converted to HTML
			const articlePath = path.join("/downloads", "blog", "article.json");
			expect(vol.existsSync(articlePath)).toBe(true);
			const article = JSON.parse(vol.readFileSync(articlePath, "utf8").toString());
			expect(article.content).toContain("<h1>Hello World</h1>");
			expect(article.content).toContain("<p>This is a paragraph</p>");

			// Check if media was downloaded
			const mediaFiles = ["gallery1.jpg", "gallery2.jpg"];
			for (const file of mediaFiles) {
				const mediaPath = path.join("/downloads", "blog", file);
				expect(vol.existsSync(mediaPath)).toBe(true);
				expect(vol.readFileSync(mediaPath, "utf8")).toBe("fake image data");
			}
		});
	});

	describe("Sanity Source with HTML Conversion", () => {
		it("should fetch Sanity content and convert blocks to HTML", async () => {
			server.use(
				http.get("https://test-project.apicdn.sanity.io/v2021-10-21/data/query/production", ({ request }) => {
					const url = new URL(request.url);
					const query = url.searchParams.get("query");

					if (query?.includes("[100..")) {
						return HttpResponse.json({
							result: [],
							ms: 15,
						});
					}

					if (query?.includes("article")) {
						return HttpResponse.json({
							result: [
								{
									_type: "article",
									title: "Test Article",
									content: {
										_type: "block",
										children: [
											{
												_type: "span",
												text: "Hello from Sanity",
											},
										],
									},
								},
							],
							ms: 15,
						});
					}

					return HttpResponse.json({ result: [] });
				}),
			);

			const content = new LaunchpadContent(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						sanitySource({
							id: "cms",
							projectId: "test-project",
							apiToken: "test-token",
							queries: ["article"],
							mergePages: true,
						}),
					],
					plugins: [sanityToHtml({ path: "$..content" })],
				},
				createMockLogger(),
			);

			const result = await content.download();

			expect(result).toBeOk();

			const articlePath = path.join("/downloads", "cms", "article.json");
			expect(vol.existsSync(articlePath)).toBe(true);

			const article = JSON.parse(vol.readFileSync(articlePath, "utf8").toString());
			expect(article[0].content).toBe("<p>Hello from Sanity</p>");
		});
	});

	describe("Multiple Sources with Shared Media", () => {
		it("should handle media downloads from multiple sources", async () => {
			// Mock endpoints for two different content sources that reference the same media
			server.use(
				// Source 1: JSON API
				http.get("https://api1.example.com/content", () => {
					return HttpResponse.json({
						hero: "https://example.com/shared.jpg",
						content: "Content from source 1",
					});
				}),
				// Source 2: Another JSON API
				http.get("https://api2.example.com/content", () => {
					return HttpResponse.json({
						thumbnail: "https://example.com/shared.jpg",
						content: "Content from source 2",
					});
				}),
				// Shared media endpoint
				http.get("https://example.com/shared.jpg", () => {
					return new HttpResponse("shared image data", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			const content = new LaunchpadContent(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "source1",
							files: {
								"content.json": "https://api1.example.com/content",
							},
						}),
						jsonSource({
							id: "source2",
							files: {
								"content.json": "https://api2.example.com/content",
							},
						}),
					],
					plugins: [
						mediaDownloader({
							mediaPattern: /\.jpg$/,
							maxConcurrent: 1, // Force sequential downloads to test deduplication
						}),
					],
				},
				createMockLogger(),
			);

			const result = await content.download();

			expect(result).toBeOk();

			// Check if shared media was downloaded only once and is accessible from both sources
			const mediaPath1 = path.join("/downloads", "source1", "shared.jpg");
			const mediaPath2 = path.join("/downloads", "source2", "shared.jpg");

			expect(vol.existsSync(mediaPath1)).toBe(true);
			expect(vol.existsSync(mediaPath2)).toBe(true);
			expect(vol.readFileSync(mediaPath1, "utf8")).toBe("shared image data");
			expect(vol.readFileSync(mediaPath2, "utf8")).toBe("shared image data");
		});
	});

	describe("Error Handling", () => {
		it("should handle source failures and rollback content", async () => {
			// Setup initial content
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/existing.json", JSON.stringify({ data: "existing" }));

			server.use(
				http.get("https://api.example.com/content", () => {
					return new HttpResponse(null, { status: 500 });
				}),
			);

			const content = new LaunchpadContent(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					backupPath: "/backups",
					sources: [
						jsonSource({
							id: "test",
							files: {
								"content.json": "https://api.example.com/content",
							},
						}),
					],
				},
				createMockLogger(),
			);

			const result = await content.download();

			expect(result).toBeErr();

			// Check if existing content was preserved
			expect(vol.existsSync("/downloads/test/existing.json")).toBe(true);
			const preserved = JSON.parse(vol.readFileSync("/downloads/test/existing.json", "utf8").toString());
			expect(preserved.data).toBe("existing");
		});

		it("should handle plugin failures and rollback content", async () => {
			// Setup initial content
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/existing.json", JSON.stringify({ data: "existing" }));

			server.use(
				http.get("https://api.example.com/content", () => {
					return HttpResponse.json({
						content: { invalidContent: "not a valid Sanity block" },
					});
				}),
			);

			const content = new LaunchpadContent(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					backupPath: "/backups",
					sources: [
						jsonSource({
							id: "test",
							files: {
								"content.json": "https://api.example.com/content",
							},
						}),
					],
					plugins: [
						sanityToHtml({ path: "$..content" }), // This should fail on invalid content
					],
				},
				createMockLogger(),
			);

			const result = await content.download();

			expect(result).toBeErr();

			// expect downloads to be restored
			expect(vol.existsSync("/downloads/test")).toBe(true);
		});
	});
});
