import { createClient } from "@sanity/client";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sanitySource from "../sanity-source.js";
import { createFetchContext, setupMSWServer } from "./helpers.js";

vi.mock("@sanity/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@sanity/client")>();
	return {
		...actual,
		createClient: vi.fn(actual.createClient),
	};
});

const { server } = setupMSWServer();

beforeAll(() => {
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});
afterAll(() => {
	vi.useRealTimers();
});

describe("sanitySource", () => {
	it("should fail with missing required options", async () => {
		// @ts-expect-error - testing invalid options
		const result = sanitySource({
			id: "test-sanity",
			// missing projectId and apiToken
		});

		await expect(result).rejects.toThrow();
	});

	it("should fetch data with simple type queries", async () => {
		// Mock Sanity API responses
		server.use(
			// First page of 'test' type
			http.get(
				"https://test-project.api.sanity.io/v2021-10-21/data/query/production",
				({ request }) => {
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
				},
			),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test", "article"],
			mergePages: true,
			useCdn: false,
		});

		const result = await source.fetch(createFetchContext());

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
			http.get(
				"https://test-project.api.sanity.io/v2021-10-21/data/query/production",
				({ request }) => {
					const url = new URL(request.url);
					const query = url.searchParams.get("query");

					if (
						query === '*[_type == "custom"][0..99]' ||
						query === '*[_type == "custom"][100..199]'
					) {
						return HttpResponse.json({
							result: [{ _type: "custom", data: "Custom Data" }],
							ms: 15,
						});
					}

					return HttpResponse.json({
						result: [],
						ms: 5,
					});
				},
			),
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

		await expect(result[0]!.data).rejects.toThrow();
	});

	it("should respect pagination options", async () => {
		server.use(
			http.get(
				"https://test-project.api.sanity.io/v2021-10-21/data/query/production",
				({ request }) => {
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
				},
			),
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

	it("should support single item responses", async () => {
		server.use(
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", () => {
				return HttpResponse.json({
					result: { _type: "test", title: "Test Document" },
					ms: 15,
				});
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: [
				{
					id: "custom1",
					query: '*[_type == "custom"][0]',
				},
				{
					id: "custom2",
					query: '*[_type == "custom"][0..5]',
				},
			],
			limit: 50,
			mergePages: false,
			useCdn: false,
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(2);

		const data1 = await result[0]!.data;
		const data2 = await result[0]!.data;

		// it should return the single item directly instead of an async iterator
		expect(data1).toEqual({ _type: "test", title: "Test Document" });
		expect(data2).toEqual({ _type: "test", title: "Test Document" });
	});

	it("should cancel request on abortSignal", async () => {
		const ctx = createFetchContext();

		server.use(
			http.get("https://test-project.api.sanity.io/v2021-10-21/data/query/production", async () => {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				return HttpResponse.json({
					result: { _type: "test", title: "Test Document" },
					ms: 2000,
				});
			}),
		);

		const source = await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: [
				{
					id: "custom1",
					query: '*[_type == "custom"][0]',
				},
			],
			limit: 50,
			mergePages: false,
			useCdn: false,
		});

		const result = source.fetch(ctx);

		const promise = result[0]!.data;

		const abortReason = "Some abort reason";

		// Abort the request after a short delay
		setTimeout(() => {
			ctx._abortController.abort(abortReason);
		}, 50);

		vi.runAllTimersAsync();

		await expect(promise).rejects.toThrowError(abortReason);
	});

	it("should configure the Sanity client with a default 60s request timeout", async () => {
		await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test"],
		});

		expect(createClient).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 60_000 }));
	});

	it("should allow overriding the Sanity client request timeout", async () => {
		await sanitySource({
			id: "test-sanity",
			projectId: "test-project",
			apiToken: "test-token",
			queries: ["test"],
			maxTimeout: 5_000,
		});

		expect(createClient).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 5_000 }));
	});
});
