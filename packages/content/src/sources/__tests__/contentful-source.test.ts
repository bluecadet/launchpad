import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataStore } from "../../utils/data-store.js";
import contentfulSource from "../contentful-source.js";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});
afterAll(() => {
	server.close();
	vi.useRealTimers();
});
afterEach(() => server.resetHandlers());

function createFetchContext() {
	return {
		logger: createMockLogger(),
		dataStore: new DataStore("/"),
	};
}

describe("contentfulSource", () => {
	it("should fail with missing delivery token when not using preview", async () => {
		expect(
			async () =>
				// @ts-expect-error - testing invalid options
				await contentfulSource({
					id: "test-contentful",
					space: "test-space",
					// missing deliveryToken
					usePreviewApi: false,
				}),
		).rejects.toThrow();
	});

	it("should fail with missing preview token when using preview", async () => {
		expect(
			async () =>
				// @ts-expect-error - testing invalid options
				await contentfulSource({
					id: "test-contentful",
					space: "test-space",
					// missing previewToken
					usePreviewApi: true,
				}),
		).rejects.toThrow();
	});

	it("should fetch data with delivery token", async () => {
		server.use(
			http.get(
				"https://cdn.contentful.com/spaces/test-space/environments/master/entries",
				({ request }) => {
					const url = new URL(request.url);
					const skip = Number.parseInt(url.searchParams.get("skip") || "0");

					// Return empty results after first page
					if (skip > 0) {
						return HttpResponse.json({
							items: [],
							includes: {},
							total: 1,
							skip,
							limit: 1000,
						});
					}

					return HttpResponse.json({
						items: [
							{
								sys: { type: "Entry", contentType: { sys: { id: "article" } } },
								fields: { title: "Test Entry" },
							},
						],
						includes: {
							Asset: [
								{
									sys: { type: "Asset", id: "test-asset" },
									fields: {
										title: "Test Asset",
										file: { url: "//test.com/image.jpg" },
									},
								},
							],
						},
						total: 1,
						skip: 0,
						limit: 1000,
					});
				},
			),
		);

		const source = await contentfulSource({
			id: "test-contentful",
			space: "test-space",
			deliveryToken: "test-token",
			usePreviewApi: false,
		});

		const result = await source.fetch(createFetchContext());

		const data = (await result.data) as {
			entries: any[];
			assets: any[];
		};

		expect(data.entries).toHaveLength(1);
		expect(data.assets).toHaveLength(1);

		// Check first entry
		expect(data.entries[0]).toEqual({
			sys: { type: "Entry", contentType: { sys: { id: "article" } } },
			fields: { title: "Test Entry" },
		});
	});

	it("should fetch data with preview token", async () => {
		server.use(
			http.get(
				"https://preview.contentful.com/spaces/test-space/environments/master/entries",
				({ request }) => {
					const url = new URL(request.url);
					const skip = Number.parseInt(url.searchParams.get("skip") || "0");

					if (skip > 0) {
						return HttpResponse.json({
							items: [],
							includes: {},
							total: 1,
							skip,
							limit: 1000,
						});
					}

					return HttpResponse.json({
						items: [
							{
								sys: { type: "Entry", contentType: { sys: { id: "article" } } },
								fields: { title: "Preview Entry" },
							},
						],
						includes: {
							Asset: [
								{
									sys: { type: "Asset" },
									fields: {
										title: "Preview Asset",
										file: { url: "//test.com/preview.jpg" },
									},
								},
							],
						},
						total: 1,
						skip: 0,
						limit: 1000,
					});
				},
			),
		);

		const source = await contentfulSource({
			id: "test-contentful",
			space: "test-space",
			previewToken: "test-preview-token",
			usePreviewApi: true,
		});

		const result = source.fetch(createFetchContext());

		const data = await result.data;

		expect(data).toMatchInlineSnapshot(`
			{
			  "assets": [
			    {
			      "fields": {
			        "file": {
			          "url": "https://test.com/preview.jpg",
			        },
			        "title": "Preview Asset",
			      },
			      "sys": {
			        "type": "Asset",
			      },
			    },
			  ],
			  "entries": [
			    {
			      "fields": {
			        "title": "Preview Entry",
			      },
			      "sys": {
			        "contentType": {
			          "sys": {
			            "id": "article",
			          },
			        },
			        "type": "Entry",
			      },
			    },
			  ],
			}
		`);
	});

	it("should handle API errors", async () => {
		server.use(
			http.get("https://cdn.contentful.com/spaces/test-space/environments/master/entries", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		const source = await contentfulSource({
			id: "test-contentful",
			space: "test-space",
			deliveryToken: "test-token",
			retryOnError: false,
		});

		const result = source.fetch(createFetchContext());

		expect(result.data).rejects.toThrow();
	});

	it("should handle contentful errors array", async () => {
		server.use(
			http.get("https://cdn.contentful.com/spaces/test-space/environments/master/entries", () => {
				return HttpResponse.json({
					sys: { type: "Error" },
					errors: [{ message: "Invalid content type" }],
				});
			}),
		);

		const source = await contentfulSource({
			id: "test-contentful",
			space: "test-space",
			deliveryToken: "test-token",
		});

		const result = source.fetch(createFetchContext());

		expect(result.data).rejects.toThrow();
	});

	it("should respect content type filtering", async () => {
		server.use(
			http.get(
				"https://cdn.contentful.com/spaces/test-space/environments/master/entries",
				({ request }) => {
					const url = new URL(request.url);
					const contentType = url.searchParams.get("sys.contentType.sys.id[in]");

					expect(contentType).toBe("article");

					const skip = Number.parseInt(url.searchParams.get("skip") || "0");

					if (skip > 0) {
						return HttpResponse.json({
							items: [],
							includes: {},
							total: 1,
							skip,
							limit: 1000,
						});
					}

					return HttpResponse.json({
						items: [
							{
								sys: { type: "Entry", contentType: { sys: { id: "article" } } },
								fields: { title: "Filtered Entry" },
							},
						],
						includes: {},
						total: 1,
						skip: 0,
						limit: 1000,
					});
				},
			),
		);

		const source = await contentfulSource({
			id: "test-contentful",
			space: "test-space",
			deliveryToken: "test-token",
			contentTypes: ["article"],
			retryOnError: false,
		});

		const result = source.fetch(createFetchContext());

		const data = (await result.data) as {
			entries: any[];
			assets: any[];
		};

		expect(data.entries.every((entry) => entry.sys.contentType.sys.id === "article")).toBe(true);
	});
});
