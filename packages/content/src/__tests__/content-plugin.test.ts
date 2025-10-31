import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { PluginDriver } from "@bluecadet/launchpad-utils/plugin-driver";
import { describe, expect, it, vi } from "vitest";
import { contentConfigSchema } from "../content-config.js";
import { ContentError, ContentPluginDriver, defineContentPlugin } from "../content-plugin.js";
import { DataStore } from "../utils/data-store.js";

describe("ContentPluginDriver", () => {
	const createMockContext = () => {
		const dataStore = new DataStore("/");
		const options = contentConfigSchema.parse({
			downloadPath: "/downloads/",
			tempPath: "/temp/",
			backupPath: "/backups/",
		});

		const paths = {
			getDownloadPath: (source?: string) => (source ? `/downloads/${source}` : "/downloads"),
			getTempPath: (source?: string, plugin?: string) =>
				source ? `/temp/${plugin}/${source}` : `/temp/${plugin}`,

			getBackupPath: (source?: string) => (source ? `/backups/${source}` : "/backups"),
		};

		return { dataStore, options, paths };
	};

	describe("plugin context", () => {
		it("should provide correct context to plugins", async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver({ logger: baseLogger });
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths,
			});

			const plugin = defineContentPlugin({
				name: "test-plugin",
				hooks: {
					onContentFetchDone(ctx) {
						expect(ctx.data).toBe(dataStore);
						expect(ctx.contentOptions).toBe(options);
						expect(ctx.paths.getDownloadPath()).toBe(paths.getDownloadPath());
						expect(ctx.paths.getBackupPath()).toBe(paths.getBackupPath());
						// Test plugin-specific temp path
						expect(ctx.paths.getTempPath("source")).toBe("/temp/test-plugin/source");
					},
				},
			});

			contentDriver.add(plugin);
			const result = await contentDriver.runHookSequential("onContentFetchDone");
			expect(result).toBeOk();
		});

		it("should handle plugin-specific temp paths correctly", async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver({ logger: baseLogger });
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths,
			});

			const plugin1 = defineContentPlugin({
				name: "plugin1",
				hooks: {
					onContentFetchDone(ctx) {
						expect(ctx.paths.getTempPath("source")).toBe("/temp/plugin1/source");
					},
				},
			});

			const plugin2 = defineContentPlugin({
				name: "plugin2",
				hooks: {
					onContentFetchDone(ctx) {
						expect(ctx.paths.getTempPath("source")).toBe("/temp/plugin2/source");
					},
				},
			});

			contentDriver.add(plugin1);
			contentDriver.add(plugin2);
			const result = await contentDriver.runHookSequential("onContentFetchDone");
			expect(result).toBeOk();
		});
	});

	describe("error handling", () => {
		it("should handle setup errors with ContentError", async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver({ logger: baseLogger });
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths,
			});

			const onSetupError = vi.fn();
			const error = new Error("Setup failed");

			const plugin = defineContentPlugin({
				name: "error-plugin",
				hooks: {
					onSetupError,
				},
			});

			const contentErr = new ContentError("Plugin setup failed", error);
			contentDriver.add(plugin);
			await contentDriver.runHookSequential("onSetupError", contentErr);

			expect(onSetupError).toHaveBeenCalledWith(expect.anything(), contentErr);
		});

		it("should handle fetch errors with ContentError", async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver({ logger: baseLogger });
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths,
			});

			const onContentFetchError = vi.fn();
			const error = new Error("Fetch failed");

			const plugin = defineContentPlugin({
				name: "error-plugin",
				hooks: {
					onContentFetchError,
				},
			});

			const contentErr = new ContentError("Content fetch failed", error);
			contentDriver.add(plugin);
			await contentDriver.runHookSequential("onContentFetchError", contentErr);

			expect(onContentFetchError).toHaveBeenCalledWith(expect.anything(), expect.any(ContentError));
		});
	});

	describe("plugin lifecycle", () => {
		it("should call hooks in correct order", async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver({ logger: baseLogger });
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths,
			});

			const order: string[] = [];

			const plugin = defineContentPlugin({
				name: "lifecycle-plugin",
				hooks: {
					onContentFetchSetup() {
						order.push("setup");
					},
					onContentFetchDone() {
						order.push("done");
					},
				},
			});

			contentDriver.add(plugin);
			await contentDriver.runHookSequential("onContentFetchSetup");
			await contentDriver.runHookSequential("onContentFetchDone");

			expect(order).toEqual(["setup", "done"]);
		});
	});
});
