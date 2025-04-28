import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataStore } from "../../utils/data-store.js";
import jsonSource from "../json-source.js";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
	vi.useFakeTimers();
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

describe("jsonSource", () => {
	it("should fetch JSON data successfully", async () => {
		server.use(
			http.get("https://api.example.com/data1", () => {
				return HttpResponse.json({ key: "value1" });
			}),
			http.get("https://api.example.com/data2", () => {
				return HttpResponse.json({ key: "value2" });
			}),
		);

		const source = await jsonSource({
			id: "test-json",
			files: {
				"data1.json": "https://api.example.com/data1",
				"data2.json": "https://api.example.com/data2",
			},
		});

		const result = source.fetch(createFetchContext());
		expect(result).toBeInstanceOf(Array);
		expect(result).toHaveLength(2);

		const data1 = await result[0]!.data;
		const data2 = await result[1]!.data;

		expect(data1).toEqual({ key: "value1" });
		expect(data2).toEqual({ key: "value2" });
	});

	it("should throw on fetch errors", async () => {
		server.use(
			http.get("https://api.example.com/error", () => {
				return HttpResponse.error();
			}),
		);

		const source = await jsonSource({
			id: "test-json-error",
			files: {
				"error.json": "https://api.example.com/error",
			},
		});

		const result = source.fetch(createFetchContext());
		expect(result).toHaveLength(1);

		await expect(async () => {
			await result[0]!.data;
		}).rejects.toThrow();
	});

	it("should throw on parse errors", async () => {
		server.use(
			http.get("https://api.example.com/invalid", () => {
				return new HttpResponse("Invalid JSON", {
					headers: { "Content-Type": "application/json" },
				});
			}),
		);

		const source = await jsonSource({
			id: "test-json-parse-error",
			files: {
				"invalid.json": "https://api.example.com/invalid",
			},
		});

		const result = source.fetch(createFetchContext());

		expect(result).toHaveLength(1);

		await expect(async () => {
			await result[0]!.data;
		}).rejects.toThrow();
	});

	it("should respect the maxTimeout option", async () => {
		server.use(
			http.get("https://api.example.com/slow", async () => {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				return HttpResponse.json({ key: "value" });
			}),
		);

		const source = await jsonSource({
			id: "test-json-timeout",
			files: {
				"slow.json": "https://api.example.com/slow",
			},
			maxTimeout: 1000,
		});
		const result = source.fetch(createFetchContext());

		const promise = result[0]!.data;

		// Need to run the timer and wait for the rejection
		vi.runAllTimersAsync();

		await expect(promise).rejects.toThrow();
	});

	it("should throw on incomplete config", async () => {
		// @ts-expect-error - incomplete config
		await expect(() => jsonSource({})).toThrow();
	});
});
