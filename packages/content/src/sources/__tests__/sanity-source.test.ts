import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataStore } from "../../utils/data-store.js";
import sanitySource from "../sanity-source.js";

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
		dataStore: new DataStore(),
	};
}

describe("sanitySource", () => {
	it("should fail with missing required options", async () => {
		// @ts-expect-error - testing invalid options
		const result = sanitySource({
			id: "test-sanity",
			// missing projectId and apiToken
		});

		expect(result).rejects.toThrow();
	});

	it("should fetch data with simple type queries", async () => {
		// Mock Sanity API responses
		server.use(
			// First page of 'test' type
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", ({ request }) => {
				const url = new URL(request.url);

				const query = url.searchParams.get("query");

				if (query === '*[_type == "test"][0..99]') {
					return HttpResponse.json({
						result: [{ _type: "test", title: "Test Document 1" }],
						ms: 15,
					});
				}

				if (query === '*[_type == "test"][100..199]') {
					return HttpResponse.json({
						result: [{ _type: "test", title: "Test Document 2" }],
						ms: 15,
					});
				}

				if (query === '*[_type == "article"][0..99]') {
					return HttpResponse.json({
						result: [{ _type: "article", title: "Article 1" }],
						ms: 15,
					});
				}

				if (query === '*[_type == "article"][100..199]') {
					return HttpResponse.json({
						result: [{ _type: "article", title: "Article 2" }],
						ms: 15,
					});
				}

				return HttpResponse.json({
					result: [],
					ms: 5,
				});
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test", "article"],
			mergePages: true,
			useCdn: false,
		});

		const result = source.fetch(createFetchContext());

		expect(result).toHaveLength(2);

		// Check 'test' type results
		const testData = await result[0]!.data;

		expect(testData).toEqual([
			{ _type: "test", title: "Test Document 1" },
			{ _type: "test", title: "Test Document 2" },
		]);

		// Check 'article' type results
		const articleData = await result[1]!.data;
		expect(articleData).toEqual([
			{ _type: "article", title: "Article 1" },
			{ _type: "article", title: "Article 2" },
		]);
	});

	it("should fetch data with custom query objects", async () => {
		server.use(
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get("query");

				if (query === '*[_type == "custom"][0..99]' || query === '*[_type == "custom"][100..199]') {
					return HttpResponse.json({
						result: [{ _type: "custom", data: "Custom Data" }],
						ms: 15,
					});
				}

				return HttpResponse.json({
					result: [],
					ms: 5,
				});
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			mergePages: true,
			useCdn: false,
			queries: [
				{
					id: "custom",
					query: '*[_type == "custom"]',
				},
			],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		const data = await result[0]!.data;
		expect(data).toEqual([
			{ _type: "custom", data: "Custom Data" },
			{ _type: "custom", data: "Custom Data" },
		]);
	});

	it("should handle API errors", async () => {
		server.use(
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test"],
			mergePages: true,
			useCdn: false,
		});

		const result = source.fetch(createFetchContext());

		expect(result[0]!.data).rejects.toThrow();
	});

	it("should respect pagination options", async () => {
		server.use(
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get("query") || "";
				const offset = query.match(/\[(\d+)\.\./)?.at(1);

				if (offset === "100") {
					return HttpResponse.json({
						result: [],
						ms: 5,
					});
				}

				return HttpResponse.json({
					result: [{ _type: "test", title: `Test Document ${offset}` }],
					ms: 15,
				});
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test"],
			limit: 50,
			mergePages: false,
			useCdn: false,
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		const data = (await result[0]!.data) as AsyncGenerator;

		expect((await data.next()).value).toEqual([{ _type: "test", title: "Test Document 0" }]);
		expect((await data.next()).value).toEqual([{ _type: "test", title: "Test Document 50" }]);
		expect((await data.next()).done).toBe(true);
	});
});
