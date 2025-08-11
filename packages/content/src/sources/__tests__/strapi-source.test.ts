import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataStore } from "../../utils/data-store.js";
import strapiSource from "../strapi-source.js";

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
	const abortController = new AbortController();
	return {
		logger: createMockLogger(),
		dataStore: new DataStore("/"),
		abortSignal: abortController.signal,
		_abortController: abortController,
	};
}

const majorNodeVersion = Number.parseInt(process.versions.node.split(".")[0]!);

describe.runIf(majorNodeVersion < 20)("strapiSource - unsupported", () => {
	it("should fail with unsupported node version", async () => {
		await expect(() =>
			strapiSource({
				id: "test-strapi",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "password",
				version: "4",
				queries: ["test-content"],
			}),
		).rejects.toThrowError(
			`Unsupported node version ${process.versions.node}. Strapi source requires node >= 20.`,
		);
	});
});

describe.runIf(majorNodeVersion >= 20)("strapiSource", () => {
	it("should fail with unsupported strapi API version", async () => {
		await expect(() =>
			strapiSource({
				id: "test-strapi",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "password",
				// @ts-expect-error - testing invalid version
				version: "5",
				queries: ["test-content"],
			}),
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[ZodError: [
			  {
			    "received": "5",
			    "code": "invalid_enum_value",
			    "options": [
			      "3",
			      "4"
			    ],
			    "path": [
			      "version"
			    ],
			    "message": "Invalid enum value. Expected '3' | '4', received '5'"
			  }
			]]
		`);
	});

	describe("Strapi v4", () => {
		it("should authenticate and fetch data successfully", async () => {
			server.use(
				// Auth endpoint
				http.post("http://localhost:1337/auth/local", async ({ request }) => {
					const body = await request.json();
					expect(body).toEqual({
						identifier: "test@example.com",
						password: "password",
					});

					return HttpResponse.json({
						jwt: "test-token",
					});
				}),
				// Data endpoint
				http.get("http://localhost:1337/api/test-content", ({ request }) => {
					const authHeader = request.headers.get("Authorization");
					expect(authHeader).toBe("Bearer test-token");

					const url = new URL(request.url);
					const page = Number.parseInt(url.searchParams.get("pagination[page]") || "1");

					// Return empty results after first page
					if (page > 1) {
						return HttpResponse.json({
							data: [],
							meta: {
								pagination: {
									page,
									pageSize: 100,
									pageCount: 1,
									total: 1,
								},
							},
						});
					}

					return HttpResponse.json({
						data: [
							{
								id: 1,
								attributes: {
									title: "Test Content",
									description: "Test Description",
								},
							},
						],
						meta: {
							pagination: {
								page: 1,
								pageSize: 100,
								pageCount: 1,
								total: 1,
							},
						},
					});
				}),
			);

			const source = await strapiSource({
				id: "test-strapi",
				version: "4",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "password",
				queries: ["test-content"],
			});

			const result = source.fetch(createFetchContext());
			expect(result).toHaveLength(1);

			const data = (await result[0]!.data.next()).value;

			expect(data).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {
				      "description": "Test Description",
				      "title": "Test Content",
				    },
				    "id": 1,
				  },
				]
			`);

			expect((await result[0]!.data.next()).done).toBe(true);
		});

		it("should handle custom query objects", async () => {
			server.use(
				http.post("http://localhost:1337/auth/local", () => {
					return HttpResponse.json({ jwt: "test-token" });
				}),
				http.get("http://localhost:1337/api/custom-content", ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get("filters[type][$eq]")).toBe("test");
					expect(url.searchParams.get("sort[0]")).toBe("createdAt:desc");

					if (url.searchParams.get("pagination[page]") === "2") {
						return HttpResponse.json({
							data: [],
							meta: {
								pagination: { page: 2, pageSize: 100, pageCount: 1, total: 0 },
							},
						});
					}

					return HttpResponse.json({
						data: [
							{
								id: 1,
								attributes: {
									title: "Custom Content",
									type: "test",
								},
							},
						],
						meta: {
							pagination: {
								page: 1,
								pageSize: 100,
								pageCount: 1,
								total: 1,
							},
						},
					});
				}),
			);

			const source = await strapiSource({
				id: "test-strapi",
				version: "4",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "password",
				queries: [
					{
						contentType: "custom-content",
						params: {
							"filters[type][$eq]": "test",
							"sort[0]": "createdAt:desc",
						},
					},
				],
			});

			const result = source.fetch(createFetchContext());

			const data = (await result[0]!.data.next()).value;

			expect(data).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {
				      "title": "Custom Content",
				      "type": "test",
				    },
				    "id": 1,
				  },
				]
			`);

			expect((await result[0]!.data.next()).done).toBe(true);
		});
	});

	describe("Strapi v3", () => {
		it("should authenticate and fetch data successfully", async () => {
			server.use(
				http.post("http://localhost:1337/auth/local", async ({ request }) => {
					const body = await request.json();
					expect(body).toEqual({
						identifier: "test@example.com",
						password: "password",
					});

					return HttpResponse.json({
						jwt: "test-token",
					});
				}),
				http.get("http://localhost:1337/api/test-content", ({ request }) => {
					const authHeader = request.headers.get("Authorization");
					expect(authHeader).toBe("Bearer test-token");

					const url = new URL(request.url);
					const start = Number.parseInt(url.searchParams.get("_start") || "0");

					// Return empty results after first page
					if (start > 0) {
						return HttpResponse.json([]);
					}

					return HttpResponse.json([
						{
							id: 1,
							title: "Test Content V3",
							description: "Test Description V3",
						},
					]);
				}),
			);

			const source = await strapiSource({
				id: "test-strapi",
				version: "3",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "password",
				queries: ["test-content"],
			});

			const result = source.fetch(createFetchContext());
			expect(result).toHaveLength(1);

			const data = (await result[0]!.data.next()).value;
			expect(data).toMatchInlineSnapshot(`
				[
				  {
				    "description": "Test Description V3",
				    "id": 1,
				    "title": "Test Content V3",
				  },
				]
			`);

			expect((await result[0]!.data.next()).done).toBe(true);
		});
	});

	it("should handle authentication errors", async () => {
		server.use(
			http.post("http://localhost:1337/auth/local", () => {
				return new HttpResponse("Invalid credentials", { status: 401 });
			}),
		);

		await expect(
			strapiSource({
				id: "test-strapi",
				version: "4",
				baseUrl: "http://localhost:1337",
				identifier: "test@example.com",
				password: "wrong-password",
				queries: ["test-content"],
			}),
		).rejects.toThrow();
	});

	it("should handle API errors", async () => {
		server.use(
			http.post("http://localhost:1337/auth/local", () => {
				return HttpResponse.json({ jwt: "test-token" });
			}),
			http.get("http://localhost:1337/api/test-content", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		const source = await strapiSource({
			id: "test-strapi",
			version: "4",
			baseUrl: "http://localhost:1337",
			identifier: "test@example.com",
			password: "password",
			queries: ["test-content"],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		await expect(async () => (await result[0]!.data.next()).value).rejects.toThrow();
	});

	it("should cancel request on abortSignal", async () => {
		const ctx = createFetchContext();

		server.use(
			http.post("http://localhost:1337/auth/local", () => {
				return HttpResponse.json({ jwt: "test-token" });
			}),
			http.get("http://localhost:1337/api/custom-content", async ({ request }) => {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				const url = new URL(request.url);
				expect(url.searchParams.get("filters[type][$eq]")).toBe("test");
				expect(url.searchParams.get("sort[0]")).toBe("createdAt:desc");

				if (url.searchParams.get("pagination[page]") === "2") {
					return HttpResponse.json({
						data: [],
						meta: {
							pagination: { page: 2, pageSize: 100, pageCount: 1, total: 0 },
						},
					});
				}

				return HttpResponse.json({
					data: [
						{
							id: 1,
							attributes: {
								title: "Custom Content",
								type: "test",
							},
						},
					],
					meta: {
						pagination: {
							page: 1,
							pageSize: 100,
							pageCount: 1,
							total: 1,
						},
					},
				});
			}),
		);

		const source = await strapiSource({
			id: "test-strapi",
			version: "4",
			baseUrl: "http://localhost:1337",
			identifier: "test@example.com",
			password: "password",
			queries: [
				{
					contentType: "custom-content",
					params: {
						"filters[type][$eq]": "test",
						"sort[0]": "createdAt:desc",
					},
				},
			],
		});

		const result = source.fetch(ctx);

		const promise = result[0]!.data.next();

		const abortReason = "Some abort reason";

		// Abort the request after a short delay
		setTimeout(() => {
			ctx._abortController.abort(abortReason);
		}, 100);

		vi.runAllTimersAsync();

		await expect(promise).rejects.toThrowError(abortReason);
	});
});
