import Airtable from "airtable";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import airtableSource from "../airtable-source.js";
import { createFetchContext, setupMSWServer } from "./helpers.js";

const { server } = setupMSWServer();

beforeAll(() => {
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
});
afterAll(() => {
	vi.useRealTimers();
});

describe("airtableSource", () => {
	it("should fetch regular table data successfully", async () => {
		server.use(
			http.get("https://api.airtable.com/v0/regular-base/table1", async ({ request }) => {
				const authHeader = request.headers.get("Authorization");
				expect(authHeader).toBe("Bearer test-key");

				const url = new URL(request.url);
				const offset = url.searchParams.get("offset");

				// Return empty results after first page
				if (offset) {
					return HttpResponse.json({
						records: [],
					});
				}

				return HttpResponse.json({
					records: [
						{
							id: "1",
							fields: { name: "Test 1", value: "Value 1" },
							createdTime: "2024-01-01",
						},
						{
							id: "2",
							fields: { name: "Test 2", value: "Value 2" },
							createdTime: "2024-01-02",
						},
					],
					offset: "next_page_token",
				});
			}),
		);

		const source = await airtableSource({
			id: "test-airtable",
			baseId: "regular-base",
			apiKey: "test-key",
			tables: ["table1"],
		});

		const result = source.fetch(createFetchContext());

		expect(result).toHaveLength(1);

		const data = await result[0]!.data;

		expect(data).toMatchInlineSnapshot(`
			[
			  {
			    "id": "1",
			    "name": "Test 1",
			    "value": "Value 1",
			  },
			  {
			    "id": "2",
			    "name": "Test 2",
			    "value": "Value 2",
			  },
			]
		`);
	});

	it("should fetch and transform key-value table data successfully", async () => {
		server.use(
			http.get("https://api.airtable.com/v0/kv-base/settings", ({ request }) => {
				const authHeader = request.headers.get("Authorization");
				expect(authHeader).toBe("Bearer test-key");

				const url = new URL(request.url);
				const offset = url.searchParams.get("offset");

				if (offset) {
					return HttpResponse.json({
						records: [],
					});
				}

				return HttpResponse.json({
					records: [
						{
							id: "1",
							fields: { key: "key1", value: "value1" },
							createdTime: "2024-01-01",
						},
						{
							id: "2",
							fields: { key: "key2", value: "123" },
							createdTime: "2024-01-01",
						},
						{
							id: "3",
							fields: { key: "key3", value: "true" },
							createdTime: "2024-01-01",
						},
						{
							id: "4",
							fields: { key: "array[0]", value: "first" },
							createdTime: "2024-01-01",
						},
						{
							id: "5",
							fields: { key: "array[1]", value: "second" },
							createdTime: "2024-01-01",
						},
					],
				});
			}),
		);

		const source = await airtableSource({
			id: "test-airtable",
			baseId: "kv-base",
			apiKey: "test-key",
			keyValueTables: ["settings"],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		const data = await result[0]!.data;

		expect(data).toEqual({
			key1: "value1",
			key2: 123, // numeric string converted to number
			key3: true, // 'true' string converted to boolean
			array: ["first", "second"], // array[0] and array[1] combined
		});
	});

	it("should handle API errors", async () => {
		server.use(
			http.get("https://api.airtable.com/v0/error-base/error-table", () => {
				return new HttpResponse("Internal Server Error", { status: 500 });
			}),
		);

		const source = await airtableSource({
			id: "test-airtable",
			baseId: "error-base",
			apiKey: "test-key",
			tables: ["error-table"],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		await expect(result[0]!.data).rejects.toThrow();
	});

	it("should handle invalid key-value table data", async () => {
		server.use(
			http.get("https://api.airtable.com/v0/invalid-kv-base/invalid-table", () => {
				return HttpResponse.json({
					records: [
						{
							id: "1",
							fields: { single_column: "invalid" },
							createdTime: "2024-01-01",
						},
					],
				});
			}),
		);

		const source = await airtableSource({
			id: "test-airtable",
			baseId: "invalid-kv-base",
			apiKey: "test-key",
			keyValueTables: ["invalid-table"],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		await expect(result[0]!.data).rejects.toThrow();
	});

	it("should handle unauthorized access", async () => {
		server.use(
			http.get("https://api.airtable.com/v0/unauthorized-base/table", () => {
				return new HttpResponse("Unauthorized", { status: 401 });
			}),
		);

		const source = await airtableSource({
			id: "test-airtable",
			baseId: "unauthorized-base",
			apiKey: "invalid-key",
			tables: ["table"],
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		await expect(result[0]!.data).rejects.toThrow();
	});

	it("should configure the Airtable client with a default 60s request timeout", async () => {
		const configureSpy = vi.spyOn(Airtable, "configure");

		await airtableSource({
			id: "test-airtable",
			baseId: "timeout-base",
			apiKey: "test-key",
			tables: ["table1"],
		});

		expect(configureSpy).toHaveBeenCalledWith(expect.objectContaining({ requestTimeout: 60_000 }));

		configureSpy.mockRestore();
	});

	it("should allow overriding the Airtable client request timeout", async () => {
		const configureSpy = vi.spyOn(Airtable, "configure");

		await airtableSource({
			id: "test-airtable",
			baseId: "timeout-base",
			apiKey: "test-key",
			tables: ["table1"],
			maxTimeout: 5_000,
		});

		expect(configureSpy).toHaveBeenCalledWith(expect.objectContaining({ requestTimeout: 5_000 }));

		configureSpy.mockRestore();
	});
});
