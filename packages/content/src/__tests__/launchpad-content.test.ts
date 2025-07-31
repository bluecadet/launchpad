import path from "node:path/posix";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentConfigSchema } from "../content-config.js";
import { ContentError, type ContentPlugin } from "../content-plugin-driver.js";
import LaunchpadContent from "../launchpad-content.js";
import { defineSource } from "../sources/source.js";

describe("LaunchpadContent", () => {
	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	const createBasicConfig = (plugins: ContentPlugin[] = []) => {
		return {
			downloadPath: "/downloads",
			tempPath: "/temp",
			backupPath: "/backups",
			sources: [
				defineSource({
					id: "test",
					fetch: () => {
						return [
							{
								id: "doc1",
								data: Promise.resolve({
									hello: "world",
								}),
							},
						];
					},
				}),
			],
			plugins,
		};
	};

	describe("download", () => {
		it("should process all sources and write to disk", async () => {
			const content = new LaunchpadContent(createBasicConfig(), createMockLogger());
			const result = await content.download();

			expect(result).toBeOk();

			const filePath = path.join("/downloads", "test", "doc1.json");
			expect(vol.existsSync(filePath)).toBe(true);
			expect(vol.readFileSync(filePath, "utf8")).toBe(JSON.stringify({ hello: "world" }));
		});

		it("should respect keep patterns when clearing directories", async () => {
			// Setup existing files
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/.keep", "");
			vol.writeFileSync("/downloads/test/old.json", "{}");

			const config = {
				...createBasicConfig(),
				keep: [".keep"],
			};

			const content = new LaunchpadContent(config, createMockLogger());
			const result = await content.download();

			expect(result).toBeOk();

			// .keep file should still exist
			expect(vol.existsSync("/downloads/test/.keep")).toBe(true);
			// old.json should be removed
			expect(vol.existsSync("/downloads/test/old.json")).toBe(false);
		});
	});

	describe("plugin system", () => {
		it("should run plugins in correct order", async () => {
			const order: string[] = [];

			const plugin1 = {
				name: "plugin1",
				hooks: {
					onContentFetchSetup: () => {
						order.push("plugin1:setup");
					},
					onContentFetchDone: () => {
						order.push("plugin1:done");
					},
				},
			};
			const plugin2 = {
				name: "plugin2",
				hooks: {
					onContentFetchSetup: () => {
						order.push("plugin2:setup");
					},
					onContentFetchDone: () => {
						order.push("plugin2:done");
					},
				},
			};

			const content = new LaunchpadContent(
				createBasicConfig([plugin1, plugin2]),
				createMockLogger(),
			);
			await content.download();

			expect(order).toEqual(["plugin1:setup", "plugin2:setup", "plugin1:done", "plugin2:done"]);
		});

		it("should handle plugin errors", async () => {
			const errorPlugin = {
				name: "error-plugin",
				hooks: {
					onContentFetchDone: () => {
						throw new Error("Plugin error");
					},
				},
			};

			const content = new LaunchpadContent(createBasicConfig([errorPlugin]), createMockLogger());

			const result = await content.download();

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
		});
	});

	describe("error handling", () => {
		it("should handle directory clearing errors", async () => {
			// Make directory read-only
			vol.mkdirSync("/downloads", { recursive: true, mode: 0o777 });
			vol.writeFileSync("/downloads/test.json", "test");
			vol.chmodSync("/downloads", 0o444);

			const content = new LaunchpadContent(createBasicConfig(), createMockLogger());
			const result = await content._clearDir("/downloads");

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
		});
	});

	describe("path handling", () => {
		it("should handle download path token replacement", () => {
			const content = new LaunchpadContent(createBasicConfig(), createMockLogger());
			const path = content._getDetokenizedPath("/path/to/%DOWNLOAD_PATH%/file", "/downloads");
			expect(path).toBe("/path/to/downloads/file");
		});

		it("should handle timestamp token replacement", () => {
			vi.useFakeTimers();

			vi.setSystemTime("2024-01-01T00:00:00.00");

			const content = new LaunchpadContent(createBasicConfig(), createMockLogger());
			const path = content._getDetokenizedPath("/path/to/%TIMESTAMP%/file", "/downloads");
			expect(path).toMatch("/path/to/2024-01-02_00-00-00/file");
			vi.useRealTimers();
		});
	});

	describe("cwd parameter", () => {
		it("should use the provided cwd for path resolution", () => {
			const content = new LaunchpadContent(createBasicConfig(), createMockLogger(), "/some/cwd");
			expect(content.getDownloadPath("/path/to/file")).toBe("/some/cwd/downloads/path/to/file");
			expect(content.getTempPath("/path/to/file")).toBe("/some/cwd/temp/path/to/file");
			expect(content.getBackupPath("/path/to/file")).toBe("/some/cwd/backups/path/to/file");
		});

		it("should default to process.cwd() if no cwd is provided", () => {
			const cwd = process.cwd();

			const content = new LaunchpadContent(createBasicConfig(), createMockLogger());
			expect(content.getDownloadPath("/path/to/file")).toBe(
				path.join(cwd, "downloads/path/to/file"),
			);
			expect(content.getTempPath("/path/to/file")).toBe(path.join(cwd, "temp/path/to/file"));
			expect(content.getBackupPath("/path/to/file")).toBe(path.join(cwd, "backups/path/to/file"));
		});
	});
});
