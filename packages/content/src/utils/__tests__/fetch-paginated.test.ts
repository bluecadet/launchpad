import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchPaginated } from "../fetch-paginated.js";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => server.close());
afterEach(() => {
	server.resetHandlers();
	vi.restoreAllMocks();
});

describe("fetchPaginated", () => {
	const mockLogger = createMockLogger();

	it("should fetch all pages as AsyncGenerator", async () => {
		let callCount = 0;
		server.use(
			http.get("http://example.com/api", ({ request }) => {
				const url = new URL(request.url);
				const limit = Number(url.searchParams.get("limit"));
				const offset = Number(url.searchParams.get("offset"));
				callCount++;

				if (offset >= 30) {
					return HttpResponse.json([]);
				}

				return HttpResponse.json(Array.from({ length: limit }, (_, i) => ({ id: offset + i + 1 })));
			}),
		);

		const generator = fetchPaginated({
			limit: 10,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) => fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then((res) => res.json()),
		});

		const pages: unknown[] = [];
		for await (const page of generator) {
			pages.push(page);
		}

		expect(pages).toHaveLength(3);
		expect(pages.flat()).toHaveLength(30);
		expect(callCount).toBe(4); // 3 successful calls + 1 empty result
	});

	it("should fetch all pages as merged array when mergePages is true", async () => {
		let callCount = 0;
		server.use(
			http.get("http://example.com/api", ({ request }) => {
				const url = new URL(request.url);
				const limit = Number(url.searchParams.get("limit"));
				const offset = Number(url.searchParams.get("offset"));
				callCount++;

				if (offset >= 30) {
					return HttpResponse.json([]);
				}

				return HttpResponse.json(Array.from({ length: limit }, (_, i) => ({ id: offset + i + 1 })));
			}),
		);

		const result = await fetchPaginated({
			limit: 10,
			logger: mockLogger,
			mergePages: true,
			fetchPageFn: ({ limit, offset }) => fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then((res) => res.json()),
		});

		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(30);
		expect(result[0]).toEqual({ id: 1 });
		expect(result[29]).toEqual({ id: 30 });
		expect(callCount).toBe(4); // 3 successful calls + 1 empty result
	});

	it("should handle early termination", async () => {
		let callCount = 0;
		server.use(
			http.get("http://example.com/api", () => {
				callCount++;
				if (callCount === 2) {
					return HttpResponse.json([]);
				}
				return HttpResponse.json([{ id: callCount }]);
			}),
		);

		const generator = fetchPaginated({
			limit: 1,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) => fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then((res) => res.json()),
		});

		const pages: unknown[] = [];
		for await (const page of generator) {
			pages.push(page);
		}

		expect(pages).toHaveLength(1);
		expect(callCount).toBe(2);
	});

	it("should handle fetch errors", async () => {
		server.use(
			http.get("http://example.com/api", () => {
				return new HttpResponse(null, { status: 500 });
			}),
		);

		const generator = fetchPaginated({
			limit: 10,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) =>
				fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then((res) => {
					if (!res.ok) throw new Error("API error");
					return res.json();
				}),
		});

		await expect(() => generator.next()).rejects.toThrow("API error");
	});

	it("should respect maxFetchCount", async () => {
		let callCount = 0;
		server.use(
			http.get("http://example.com/api", ({ request }) => {
				const url = new URL(request.url);
				const limit = Number(url.searchParams.get("limit"));
				callCount++;
				return HttpResponse.json(Array.from({ length: limit }, (_, i) => ({ id: i + 1 })));
			}),
		);

		const generator = fetchPaginated({
			limit: 10,
			maxFetchCount: 2,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) => fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then((res) => res.json()),
		});

		const pages: unknown[] = [];
		for await (const page of generator) {
			pages.push(page);
		}

		expect(pages).toHaveLength(2);
		expect(callCount).toBe(2);
	});
});
