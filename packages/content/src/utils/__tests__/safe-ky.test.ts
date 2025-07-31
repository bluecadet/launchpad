import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { ok } from "neverthrow";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SafeKyFetchError, SafeKyParseError, safeKy } from "../safe-ky.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe("safeKy", () => {
	it("should handle successful requests", async () => {
		server.use(
			http.get("https://api.example.com/json", () => {
				return HttpResponse.json({ data: "test" });
			}),
			http.get("https://api.example.com/text", () => {
				return HttpResponse.text("test");
			}),
			http.get("https://api.example.com/arrayBuffer", () => {
				return HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer);
			}),
			http.get("https://api.example.com/blob", () => {
				return new HttpResponse(new Blob(["test"]));
			}),
		);

		const jsonResult = await safeKy("https://api.example.com/json").json();
		expect(jsonResult).toEqual(ok({ data: "test" }));

		const textResult = await safeKy("https://api.example.com/text").text();
		expect(textResult).toEqual(ok("test"));

		const arrayBufferResult = await safeKy("https://api.example.com/arrayBuffer").arrayBuffer();
		expect(arrayBufferResult).toEqual(ok(new Uint8Array([1, 2, 3]).buffer));

		const blobResult = await safeKy("https://api.example.com/blob").blob();
		expect(blobResult).toEqual(ok(new Blob(["test"])));
	});

	it("should handle network errors", async () => {
		server.use(
			http.get("https://api.example.com", () => {
				return HttpResponse.error();
			}),
		);

		const result = safeKy("https://api.example.com", {
			retry: { limit: 0 },
		});

		const jsonResult = await result.json();
		expect(jsonResult).toBeErr();
		expect(jsonResult._unsafeUnwrapErr()).toBeInstanceOf(SafeKyFetchError);
		expect(jsonResult._unsafeUnwrapErr().message).toContain("Error during request");
	});

	it("should handle parsing errors", async () => {
		server.use(
			http.get("https://api.example.com", () => {
				return new HttpResponse("Invalid JSON", {
					headers: { "Content-Type": "application/json" },
				});
			}),
		);

		const result = safeKy("https://api.example.com");

		const jsonResult = await result.json();
		expect(jsonResult).toBeErr();
		expect(jsonResult._unsafeUnwrapErr()).toBeInstanceOf(SafeKyParseError);
		expect(jsonResult._unsafeUnwrapErr().message).toContain("Error parsing JSON");
	});
});
