import fs from "node:fs/promises";
import path from "node:path";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import symlink from "../symlink.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

describe("symlink plugin", () => {
	beforeEach(() => {
		vol.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should create symlink from source to target", async () => {
		// Setup test files
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
		});

		vi.spyOn(fs, "symlink");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.symlink).toHaveBeenCalledWith(path.resolve("source"), path.resolve("target"));
	});

	it("should throw error if source does not exist", async () => {
		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "nonexistent",
			target: "target",
		});

		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow("Source directory");
	});

	it("should skip if target symlink already exists", async () => {
		// Setup source
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");
		vol.symlinkSync("source", "target");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
		});

		vi.spyOn(fs, "symlink");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.symlink).not.toHaveBeenCalled();
	});

	it("should remove existing non-symlink target before creating symlink", async () => {
		// Setup source
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");
		vol.mkdirSync("target/something/else", { recursive: true });
		vol.writeFileSync("target/something/else/file.txt", "old content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
		});

		vi.spyOn(fs, "rm");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.rm).toHaveBeenCalledWith(path.resolve("target"), { recursive: true, force: true });

		expect(vol.existsSync("target")).toBe(true);
		expect(vol.lstatSync("target").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("target/file.txt", "utf-8")).toBe("test content");
		expect(vol.existsSync("target/something/else")).toBe(false);
	});

	it("should skip when condition is false", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
			condition: false,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("target")).not.toBe(true);
	});

	it("should create symlink when condition is true", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
			condition: true,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("target")).toBe(true);
		expect(vol.lstatSync("target").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("target/file.txt", "utf-8")).toBe("test content");
	});

	it("should handle function condition that returns boolean", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const conditionFn = vi.fn().mockReturnValue(true);
		const plugin = symlink({
			source: "source",
			target: "target",
			condition: conditionFn,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(conditionFn).toHaveBeenCalled();

		expect(vol.existsSync("target")).toBe(true);
		expect(vol.lstatSync("target").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("target/file.txt", "utf-8")).toBe("test content");
	});

	it("should handle function condition that returns promise", async () => {
		vol.mkdirSync("/download/source", { recursive: true });
		vol.writeFileSync("/download/source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const conditionFn = vi.fn().mockResolvedValueOnce(false);
		const plugin = symlink({
			source: "source",
			target: "target",
			condition: conditionFn,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(conditionFn).toHaveBeenCalled();
		expect(vol.existsSync("target")).not.toBe(true);
	});

	it("should throw error if symlink creation fails", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		// Mock fs.symlink to throw an error
		vi.spyOn(fs, "symlink").mockRejectedValueOnce(new Error("Permission denied"));

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: "source",
			target: "target",
		});

		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow("Failed to create symlink");
	});

	it("should handle absolute paths", async () => {
		const absoluteSource = "/absolute/source";
		const absoluteTarget = "/absolute/target";

		vol.mkdirSync(absoluteSource, { recursive: true });
		vol.writeFileSync(path.join(absoluteSource, "file.txt"), "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			source: absoluteSource,
			target: absoluteTarget,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("/absolute/target")).toBe(true);
		expect(vol.lstatSync("/absolute/target").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("/absolute/target/file.txt", "utf-8")).toBe("test content");
	});
});
