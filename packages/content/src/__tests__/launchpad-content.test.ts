import path from "node:path";
import { createMockSubsystemCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentError, type ContentPlugin } from "../content-plugin.js";
import { createLaunchpadContent } from "../launchpad-content.js";
import { defineSource } from "../source.js";

describe("LaunchpadContent", () => {
	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	const createBasicConfig = (plugins: ContentPlugin[] = []) => {
		return {
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
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
			const factory = createLaunchpadContent(createBasicConfig());
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeOk();

			const filePath = path.resolve("/downloads", "test", "doc1.json");
			expect(vol.existsSync(filePath)).toBe(true);
			expect(vol.readFileSync(filePath, "utf8")).toBe(JSON.stringify({ hello: "world" }, null, 2));
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

			const factory = createLaunchpadContent(config);
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeOk();

			// .keep file should still exist
			expect(vol.existsSync("/downloads/test/.keep")).toBe(true);
			// old.json should be removed
			expect(vol.existsSync("/downloads/test/old.json")).toBe(false);
		});

		it("should clear data store between runs", async () => {
			const factory = createLaunchpadContent(createBasicConfig());
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.executeCommand({
				type: "content.fetch",
			});
			expect(result).toBeOk();

			// Run download again to ensure no residual data
			const result2 = await content.executeCommand({
				type: "content.fetch",
			});
			expect(result2).toBeOk();
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

			const factory = createLaunchpadContent(createBasicConfig([plugin1, plugin2]));
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.executeCommand({
				type: "content.fetch",
			});

			expect(order).toEqual(["plugin1:setup", "plugin2:setup", "plugin1:done", "plugin2:done"]);
		});

		it("should handle plugin errors", async () => {
			const errorPlugin = {
				name: "error-plugin",
				hooks: {
					onContentFetchDone: () => {
						throw new Error("this is a error");
					},
				},
			};

			const factory = createLaunchpadContent(createBasicConfig([errorPlugin]));
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
		});
	});

	describe("error handling", () => {
		it.skip("should handle directory clearing errors", async () => {
			// This test is skipped because _clearDir is a private method
			// Directory clearing is tested through integration tests
		});
	});

	describe("executeCommand", () => {
		it("should allow a single command to execute", async () => {
			const factory = createLaunchpadContent(createBasicConfig());
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeOk();
		});

		it("should reject concurrent fetch commands with ContentError", async () => {
			const slowSource = defineSource({
				id: "slow-source",
				fetch: () => {
					return [
						{
							id: "slow-doc",
							data: new Promise((resolve) => {
								setTimeout(() => {
									resolve({ data: "slow" });
								}, 100);
							}),
						},
					];
				},
			});

			const factory = createLaunchpadContent({
				...createBasicConfig(),
				sources: [slowSource],
			});
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			// First command takes time
			const firstCommand = content.executeCommand({
				type: "content.fetch",
			});

			// Try second command immediately (will be rejected because first is in progress)
			const secondCommand = content.executeCommand({
				type: "content.fetch",
			});

			const [firstResult, secondResult] = await Promise.all([firstCommand, secondCommand]);

			expect(firstResult).toBeOk();
			expect(secondResult).toBeErr();
			expect(secondResult._unsafeUnwrapErr().message).toContain(
				"Cannot perform action. Sources not idle: slow-source",
			);
		});

		it("should reject concurrent clear commands with ContentError", async () => {
			const slowSource = defineSource({
				id: "slow-source",
				fetch: () => {
					return [
						{
							id: "slow-doc",
							data: new Promise((resolve) => {
								setTimeout(() => {
									resolve({ data: "slow" });
								}, 100);
							}),
						},
					];
				},
			});

			const factory = createLaunchpadContent({
				...createBasicConfig(),
				sources: [slowSource],
			});
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			// Start a fetch
			const fetchCommand = content.executeCommand({
				type: "content.fetch",
			});

			// Try to execute clear while fetch is in progress
			const clearCommand = content.executeCommand({
				type: "content.clear",
			});

			const [fetchResult, clearResult] = await Promise.all([fetchCommand, clearCommand]);

			expect(fetchResult).toBeOk();
			expect(clearResult).toBeErr();
			expect(clearResult._unsafeUnwrapErr().message).toContain(
				"Cannot perform action. Sources not idle: slow-source",
			);
		});

		it("should allow sequential commands to execute after first completes", async () => {
			const factory = createLaunchpadContent(createBasicConfig());
			const contentResult = await factory.setup(createMockSubsystemCtx());
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result1 = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result1).toBeOk();

			const result2 = await content.executeCommand({
				type: "content.fetch",
			});

			expect(result2).toBeOk();
		});
	});
});
