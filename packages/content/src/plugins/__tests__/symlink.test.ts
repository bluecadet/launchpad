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

	it("should create symlink from target to path", async () => {
		// Setup test files
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
		});

		vi.spyOn(fs, "symlink");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.symlink).toHaveBeenCalledWith(path.resolve("source"), path.resolve("destination"));
	});

	it("should throw error if target does not exist", async () => {
		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "nonexistent",
			path: "destination",
		});

		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow("Target directory");
	});

	it("should skip if symlink path already exists", async () => {
		// Setup target
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");
		vol.symlinkSync("source", "destination");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
		});

		vi.spyOn(fs, "symlink");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.symlink).not.toHaveBeenCalled();
	});

	it("should remove existing non-symlink path before creating symlink", async () => {
		// Setup target
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");
		vol.mkdirSync("destination/something/else", { recursive: true });
		vol.writeFileSync("destination/something/else/file.txt", "old content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
		});

		vi.spyOn(fs, "rm");

		await plugin.hooks.onContentFetchDone(ctx);

		expect(fs.rm).toHaveBeenCalledWith(path.resolve("destination"), {
			recursive: true,
			force: true,
		});

		expect(vol.existsSync("destination")).toBe(true);
		expect(vol.lstatSync("destination").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("destination/file.txt", "utf-8")).toBe("test content");
		expect(vol.existsSync("destination/something/else")).toBe(false);
	});

	it("should skip when condition is false", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
			condition: false,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("destination")).not.toBe(true);
	});

	it("should create symlink when condition is true", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
			condition: true,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("destination")).toBe(true);
		expect(vol.lstatSync("destination").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("destination/file.txt", "utf-8")).toBe("test content");
	});

	it("should handle function condition that returns boolean", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const conditionFn = vi.fn().mockReturnValue(true);
		const plugin = symlink({
			target: "source",
			path: "destination",
			condition: conditionFn,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(conditionFn).toHaveBeenCalled();

		expect(vol.existsSync("destination")).toBe(true);
		expect(vol.lstatSync("destination").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("destination/file.txt", "utf-8")).toBe("test content");
	});

	it("should handle function condition that returns promise", async () => {
		vol.mkdirSync("/download/source", { recursive: true });
		vol.writeFileSync("/download/source/file.txt", "test content");

		const ctx = await createTestPluginContext();

		const conditionFn = vi.fn().mockResolvedValueOnce(false);
		const plugin = symlink({
			target: "source",
			path: "destination",
			condition: conditionFn,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(conditionFn).toHaveBeenCalled();
		expect(vol.existsSync("destination")).not.toBe(true);
	});

	it("should throw error if symlink creation fails", async () => {
		vol.mkdirSync("source", { recursive: true });
		vol.writeFileSync("source/file.txt", "test content");

		// Mock fs.symlink to throw an error
		vi.spyOn(fs, "symlink").mockRejectedValueOnce(new Error("Permission denied"));

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: "source",
			path: "destination",
		});

		await expect(plugin.hooks.onContentFetchDone(ctx)).rejects.toThrow("Failed to create symlink");
	});

	it("should handle absolute paths", async () => {
		const absoluteTarget = "/absolute/source";
		const absolutePath = "/absolute/destination";

		vol.mkdirSync(absoluteTarget, { recursive: true });
		vol.writeFileSync(path.join(absoluteTarget, "file.txt"), "test content");

		const ctx = await createTestPluginContext();

		const plugin = symlink({
			target: absoluteTarget,
			path: absolutePath,
		});

		await plugin.hooks.onContentFetchDone(ctx);

		expect(vol.existsSync("/absolute/destination")).toBe(true);
		expect(vol.lstatSync("/absolute/destination").isSymbolicLink()).toBe(true);
		expect(vol.readFileSync("/absolute/destination/file.txt", "utf-8")).toBe("test content");
	});
});
