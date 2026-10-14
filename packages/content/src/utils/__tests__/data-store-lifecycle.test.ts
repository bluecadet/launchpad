import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataStore } from "../data-store.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("DataStore filesystem lifecycle", () => {
	let directory: string;
	let storeDirectory: string;
	let store: DataStore;

	beforeEach(async () => {
		directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "launchpad-data-store-"));
		storeDirectory = path.join(directory, "nested", "store");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (store) (await store.close())._unsafeUnwrap();
		await fs.promises.rm(directory, { recursive: true, force: true });
	});

	it("does not perform directory I/O during construction", () => {
		const mkdir = vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
		const mkdirSync = vi.spyOn(fs, "mkdirSync");

		store = new DataStore(storeDirectory);

		expect(mkdir).not.toHaveBeenCalled();
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(fs.existsSync(storeDirectory)).toBe(false);
	});

	it("creates missing parents during awaited namespace initialization and backs documents with files", async () => {
		store = new DataStore(storeDirectory);
		expect(fs.existsSync(storeDirectory)).toBe(false);

		const namespace = (await store.createNamespace("source"))._unsafeUnwrap();
		const namespaceDirectory = path.join(storeDirectory, "source");
		expect((await fs.promises.stat(namespaceDirectory)).isDirectory()).toBe(true);

		const document = (
			await namespace.insert("document", Promise.resolve({ content: "original" }))
		)._unsafeUnwrap();
		expect((await document.read())._unsafeUnwrap()).toEqual({ content: "original" });
		(await document.update(() => ({ content: "updated" })))._unsafeUnwrap();
		expect((await document.read())._unsafeUnwrap()).toEqual({ content: "updated" });
		expect(
			JSON.parse(
				await fs.promises.readFile(path.join(namespaceDirectory, "document.json"), "utf8"),
			),
		).toEqual({ content: "updated" });
		expect(
			JSON.parse(
				await fs.promises.readFile(path.join(namespaceDirectory, "document.original.json"), "utf8"),
			),
		).toEqual({ content: "original" });
	});

	it("initializes an existing namespace directory without changing existing data", async () => {
		const namespaceDirectory = path.join(storeDirectory, "source");
		await fs.promises.mkdir(namespaceDirectory, { recursive: true });
		const existingPath = path.join(namespaceDirectory, "existing.json");
		const existingContent = '{"content":"keep me"}\n';
		await fs.promises.writeFile(existingPath, existingContent);

		store = new DataStore(storeDirectory);
		const namespace = (await store.createNamespace("source"))._unsafeUnwrap();
		const document = (
			await namespace.insert("new", Promise.resolve({ content: "new data" }))
		)._unsafeUnwrap();

		expect((await document.read())._unsafeUnwrap()).toEqual({ content: "new data" });
		expect(await fs.promises.readFile(existingPath, "utf8")).toBe(existingContent);
	});

	it("returns a readable error from awaited createNamespace when a file blocks the store root", async () => {
		await fs.promises.writeFile(path.join(directory, "blocked"), "not a directory");
		store = new DataStore(path.join(directory, "blocked", "store"));

		const result = await store.createNamespace("source");

		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr().message).toBe(
			`Failed to create directory ${path.join(directory, "blocked", "store", "source")}`,
		);
		expect(result._unsafeUnwrapErr().cause).toBeInstanceOf(Error);
		expect(await fs.promises.readFile(path.join(directory, "blocked"), "utf8")).toBe(
			"not a directory",
		);
	});

	it("returns Windows EPERM as an awaited namespace error with the original cause", async () => {
		store = new DataStore(storeDirectory);
		const namespaceDirectory = path.join(storeDirectory, "source");
		const permissionError = Object.assign(new Error("EPERM: operation not permitted, mkdir"), {
			code: "EPERM",
			path: namespaceDirectory,
			syscall: "mkdir",
		});
		const mkdir = vi.spyOn(fs.promises, "mkdir").mockRejectedValueOnce(permissionError);

		const result = await store.createNamespace("source");

		expect(mkdir).toHaveBeenCalledExactlyOnceWith(namespaceDirectory, { recursive: true });
		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr().message).toBe(
			`Failed to create directory ${namespaceDirectory}`,
		);
		expect(result._unsafeUnwrapErr().cause).toBe(permissionError);
	});
});
