import { vol } from "memfs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DataStore } from "../data-store.js";
import path from "node:path";

describe("SingleDocument", () => {
	const TEST_DIR = "/test/store";
	let store: DataStore;

	beforeEach(() => {
		vol.reset();
		store = new DataStore(TEST_DIR);
	});

	afterEach(() => {
		vol.reset();
	});

	it("should create and read a document", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		await namespace.insert("test-doc", Promise.resolve({ content: "test content" }));

		const docResult = namespace.document("test-doc");
		expect(docResult).toBeOk();

		const fileContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.json"), "utf-8");
		expect(JSON.parse(fileContent.toString())).toEqual({ content: "test content" });
	});

	it("should create backup file on first modification", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		const doc = await namespace.insert("test-doc", Promise.resolve({ content: "original content" }));

		await doc.update((data: any) => ({
			...data,
			content: "modified content",
		}));

		const originalContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.original.json"), "utf-8");
		expect(JSON.parse(originalContent.toString())).toEqual({ content: "original content" });

		const modifiedContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.json"), "utf-8");
		expect(JSON.parse(modifiedContent.toString())).toEqual({ content: "modified content" });
	});

	it("should apply jsonpath transformations", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		const doc = await namespace.insert(
			"test-doc",
			Promise.resolve({
				nested: { content: "test content" },
			}),
		);

		await doc.apply("$.nested.content", (value: unknown) => (typeof value === "string" ? value.toUpperCase() : value));

		const fileContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.json"), "utf-8");
		expect(JSON.parse(fileContent.toString())).toEqual({
			nested: { content: "TEST CONTENT" },
		});
	});

	it("should keep original file extension", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		await namespace.insert("test-doc.json", Promise.resolve({ content: "test content A" }));
		await namespace.insert("test-doc.extension", Promise.resolve({ content: "test content B" }));
		await namespace.insert("test-doc.extension.extension", Promise.resolve({ content: "test content C" }));

		const fileContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.json"), "utf-8");
		expect(JSON.parse(fileContent.toString())).toMatchObject({ content: "test content A" });

		const extensionFileContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.extension"), "utf-8");
		expect(JSON.parse(extensionFileContent.toString())).toMatchObject({ content: "test content B" });

		const extensionExtensionFileContent = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", "test-doc.extension.extension"), "utf-8");
		expect(JSON.parse(extensionExtensionFileContent.toString())).toMatchObject({ content: "test content C" });
	});
});

describe("BatchDocument", () => {
	const TEST_DIR = "/test/store";
	let store: DataStore;

	beforeEach(() => {
		vol.reset();
		store = new DataStore(TEST_DIR);
	});

	afterEach(() => {
		vol.reset();
	});

	it("should handle batch document creation", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		const items = [
			{ id: 1, content: "first" },
			{ id: 2, content: "second" },
			{ id: 3, content: "third" },
		];

		const doc = await namespace.insert(
			"test-doc",
			(async function* () {
				for (const item of items) {
					yield item;
				}
			})(),
		);

		// Check that all files were created
		for (let i = 0; i < items.length; i++) {
			const filename = `test-doc-${i.toString().padStart(2, "0")}.json`;
			const content = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", filename), "utf-8");
			expect(JSON.parse(content.toString())).toEqual(items[i]);
		}
	});

	it("should apply updates to all documents in batch", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const namespace = result._unsafeUnwrap();
		const items = [{ content: "first" }, { content: "second" }, { content: "third" }];

		const doc = await namespace.insert(
			"test-doc",
			(async function* () {
				for (const item of items) {
					yield item;
				}
			})(),
		);

		await doc.apply("$.content", (value: unknown) => (typeof value === "string" ? value.toUpperCase() : value));

		// Verify all documents were updated
		for (let i = 0; i < items.length; i++) {
			const filename = `test-doc-${i.toString().padStart(2, "0")}.json`;
			const content = await vol.readFileSync(path.join(TEST_DIR, "test-namespace", filename), "utf-8");
			expect(JSON.parse(content.toString())).toEqual({
				content: items[i]!.content.toUpperCase(),
			});
		}
	});
});

describe("DataStore", () => {
	const TEST_DIR = "/test/store";
	let store: DataStore;

	beforeEach(() => {
		vol.reset();
		store = new DataStore(TEST_DIR);
	});

	afterEach(() => {
		vol.reset();
	});

	it("should create namespace directory", async () => {
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeOk();

		const exists = await vol.existsSync(path.join(TEST_DIR, "test-namespace"));
		expect(exists).toBe(true);
	});

	it("should not create duplicate namespace", async () => {
		store.createNamespace("test-namespace");
		const result = await store.createNamespace("test-namespace");
		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr().message).toBe("Namespace test-namespace already exists in data store");
	});

	it("should filter documents by namespace", async () => {
		const ns1Result = await store.createNamespace("namespace1");
		const ns2Result = await store.createNamespace("namespace2");
		expect(ns1Result).toBeOk();
		expect(ns2Result).toBeOk();

		const ns1 = ns1Result._unsafeUnwrap();
		const ns2 = ns2Result._unsafeUnwrap();

		await ns1.insert("test-doc", Promise.resolve({ content: "content 1" }));
		await ns2.insert("test-doc", Promise.resolve({ content: "content 2" }));

		const result = store.filter(["namespace1"]);
		expect(result).toBeOk();

		const filtered = result._unsafeUnwrap();
		expect(filtered).toHaveLength(1);
		expect(filtered[0]!.namespaceId).toBe("namespace1");
		expect(filtered[0]!.documents).toHaveLength(1);
	});

	it("should filter documents by specific document ids", async () => {
		const nsResult = await store.createNamespace("namespace1");
		expect(nsResult).toBeOk();
		const namespace = nsResult._unsafeUnwrap();

		const doc1 = await namespace.insert("test-doc-1", Promise.resolve({ content: "content 1" }));
		await namespace.insert("test-doc-2", Promise.resolve({ content: "content 2" }));

		const result = store.filter([["namespace1", doc1.id]]);
		expect(result).toBeOk();

		const filtered = result._unsafeUnwrap();
		expect(filtered[0]!.documents).toHaveLength(1);
		expect(filtered[0]!.documents[0]!.id).toBe(doc1.id);
	});
});
