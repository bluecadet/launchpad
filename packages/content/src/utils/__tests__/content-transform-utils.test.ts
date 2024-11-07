import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, describe, expect, it } from "vitest";
import { applyTransformToFiles, getMatchingDocuments, isBlockContent } from "../content-transform-utils.js";
import { DataStore } from "../data-store.js";
import { vol } from "memfs";

describe("content-transform-utils", () => {
	afterEach(() => {
		vol.reset();
	});

	describe("getMatchingDocuments", () => {
		it("should return all documents when ids are not provided", async () => {
			const dataStore = new DataStore("/");
			const namespace = await dataStore.createNamespace("test");
			expect(namespace.isOk()).toBe(true);

			await namespace._unsafeUnwrap().insert("doc1", Promise.resolve({ content: "test1" }));
			await namespace._unsafeUnwrap().insert("doc2", Promise.resolve({ content: "test2" }));

			const result = getMatchingDocuments(dataStore);
			expect(result).toBeOk();
			expect(Array.from(result._unsafeUnwrap()).length).toBe(2);
		});

		it("should return filtered documents when ids are provided", async () => {
			const dataStore = new DataStore("/");
			const namespace1 = await dataStore.createNamespace("test1");
			const namespace2 = await dataStore.createNamespace("test2");
			await namespace1._unsafeUnwrap().insert("doc1", Promise.resolve({ content: "test1" }));
			await namespace2._unsafeUnwrap().insert("doc2", Promise.resolve({ content: "test2" }));

			const result = getMatchingDocuments(dataStore, ["test1"]);
			expect(result).toBeOk();
			expect(Array.from(result._unsafeUnwrap()).length).toBe(1);
			expect(Array.from(result._unsafeUnwrap())[0]!.id).toBe("doc1");
		});
	});

	describe("applyTransformToFiles", () => {
		it("should apply transform to matching documents", async () => {
			const dataStore = new DataStore("/");
			const namespace = await dataStore.createNamespace("test");
			await namespace._unsafeUnwrap().insert("doc1", Promise.resolve({ content: "test" }));

			const logger = createMockLogger();
			const transformFn = (content: unknown) => (typeof content === "string" ? content.toUpperCase() : content);

			await applyTransformToFiles({
				dataStore,
				path: "$.content",
				transformFn,
				logger,
				keys: ["test"],
			});

			expect(((await dataStore.getDocument("test", "doc1")._unsafeUnwrap()._read()) as any).content).toBe("TEST");
			expect(logger.debug).toHaveBeenCalled();
		});

		it("should return error if document.apply fails", async () => {
			const dataStore = new DataStore("/");
			const namespace = await dataStore.createNamespace("test");
			await namespace._unsafeUnwrap().insert("doc1", Promise.resolve({ content: "test" }));

			const logger = createMockLogger();
			const transformFn = () => {
				throw new Error("Transform error");
			};

			expect(
				applyTransformToFiles({
					dataStore,
					path: "$.content",
					transformFn,
					logger,
					keys: ["test"],
				}),
			).rejects.toThrow(/Error applying content transform/);
		});
	});

	describe("isBlockContent", () => {
		it("should return true for valid block content", () => {
			const content = { _type: "block" };
			expect(isBlockContent(content)).toBe(true);
		});

		it("should return false for non-object content", () => {
			expect(isBlockContent("not an object")).toBe(false);
			expect(isBlockContent(null)).toBe(false);
		});

		it("should return false for object without _type property", () => {
			const content = { notType: "block" };
			expect(isBlockContent(content)).toBe(false);
		});

		it('should return false for object with _type not equal to "block"', () => {
			const content = { _type: "not-block" };
			expect(isBlockContent(content)).toBe(false);
		});
	});
});
