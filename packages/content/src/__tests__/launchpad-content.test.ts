import path from "node:path";
import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { errAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAckFilePath } from "../acks.js";
import { ContentError, type ContentTransform } from "../content-transform.js";
import { content } from "../launchpad-content.js";
import { defineSource } from "../source.js";
import * as FileUtils from "../utils/file-utils.js";

describe("LaunchpadContent", () => {
	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	const createBasicConfig = (transforms: ContentTransform[] = []) => {
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
			transforms,
		};
	};

	it("registers explicit content commands in the plugin manifest", () => {
		const plugin = content(createBasicConfig());

		expect(plugin.manifest?.commands?.map((command) => command.id)).toEqual([
			"content.fetch",
			"content.clear",
			"content.ack",
		]);
	});

	describe("download", () => {
		it("should process all sources and promote staged output to disk", async () => {
			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeOk();

			const filePath = path.resolve("/downloads", "test", "doc1.json");
			expect(vol.existsSync(filePath)).toBe(true);
			expect(vol.existsSync(path.resolve("/temp", "runs"))).toBe(true);
			expect(vol.readdirSync(path.resolve("/temp", "runs"))).toHaveLength(0);
			expect(vol.readFileSync(filePath, "utf8")).toBe(JSON.stringify({ hello: "world" }, null, 2));
		});

		it("should respect keep patterns when promoting staged directories", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/.keep", "");
			vol.writeFileSync("/downloads/test/old.json", "{}");

			const config = {
				...createBasicConfig(),
				keep: [".keep"],
			};

			const factory = content(config);
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/downloads/test/.keep")).toBe(true);
			expect(vol.existsSync("/downloads/test/old.json")).toBe(false);
			expect(vol.existsSync("/downloads/test/doc1.json")).toBe(true);
		});

		it("should clear data store between runs", async () => {
			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});
			expect(result).toBeOk();

			const result2 = await instance.executeCommand({
				type: "content.fetch",
			});
			expect(result2).toBeOk();
		});

		it("should leave published content unchanged when fetch fails", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/existing.json", '{"stable":true}');

			const factory = content({
				...createBasicConfig(),
				sources: [
					defineSource({
						id: "test",
						fetch: () => [
							{
								id: "doc1",
								data: Promise.reject(new Error("fetch failed")),
							},
						],
					}),
				],
			});
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch" });

			expect(result).toBeErr();
			expect(vol.readFileSync("/downloads/test/existing.json", "utf8")).toBe('{"stable":true}');
			expect(vol.existsSync("/downloads/test/doc1.json")).toBe(false);
		});

		it("should promote root-level transform output from staged downloads", async () => {
			const rootTransform: ContentTransform = {
				name: "root-transform",
				apply: async ({ paths }) => {
					vol.mkdirSync(paths.getDownloadPath(), { recursive: true });
					vol.writeFileSync(
						path.resolve(paths.getDownloadPath(), "manifest.json"),
						'{"version":1}',
					);
				},
			};

			vol.mkdirSync("/downloads", { recursive: true });
			vol.writeFileSync("/downloads/manifest.json", '{"version":0}');

			const factory = content(createBasicConfig([rootTransform]));
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch" });

			expect(result).toBeOk();
			expect(vol.readFileSync("/downloads/manifest.json", "utf8")).toBe('{"version":1}');
		});

		it("should preserve published files when promotion fails", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/existing.json", '{"stable":true}');

			const originalReplacePath = FileUtils.replacePath;
			const replaceSpy = vi
				.spyOn(FileUtils, "replacePath")
				.mockImplementation((src, dest, options) => {
					if (path.resolve(dest) === path.resolve("/downloads/test")) {
						return errAsync(new FileUtils.FileUtilsError("promotion failed"));
					}
					return originalReplacePath(src, dest, options);
				});

			try {
				const factory = content(createBasicConfig());
				const contentResult = await factory.setup(createMockPluginCtx());
				expect(contentResult).toBeOk();
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({ type: "content.fetch" });

				expect(result).toBeErr();
				expect(vol.readFileSync("/downloads/test/existing.json", "utf8")).toBe('{"stable":true}');
				expect(vol.existsSync("/downloads/test/doc1.json")).toBe(false);
			} finally {
				replaceSpy.mockRestore();
			}
		});
	});

	describe("versioning subset-fetch guard", () => {
		const createVersionedConfig = () => ({
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			versioning: true as const,
			sources: [
				defineSource({
					id: "a",
					fetch: () => [{ id: "doc", data: Promise.resolve({ from: "a" }) }],
				}),
				defineSource({
					id: "b",
					fetch: () => [{ id: "doc", data: Promise.resolve({ from: "b" }) }],
				}),
			],
		});

		it("rejects a sources-filtered fetch when versioning is enabled, promoting nothing", async () => {
			const factory = content(createVersionedConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch", sources: ["a"] });

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("sources filter");
			expect(vol.existsSync("/downloads/manifest.json")).toBe(false);
			expect(vol.existsSync("/downloads/versions")).toBe(false);
		});

		it("leaves the active version and manifest untouched when a filtered fetch is rejected", async () => {
			vol.mkdirSync("/downloads/versions/20260101T000000Z/a", { recursive: true });
			vol.writeFileSync("/downloads/versions/20260101T000000Z/a/doc.json", '{"from":"a"}');
			const manifestJson = JSON.stringify({
				schemaVersion: 1,
				versionId: "20260101T000000Z",
				versionPath: "versions/20260101T000000Z",
				generatedAt: "2026-01-01T00:00:00.000Z",
				sources: [{ sourceId: "a", path: "a" }],
			});
			vol.writeFileSync("/downloads/manifest.json", manifestJson);

			const factory = content(createVersionedConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch", sources: ["a"] });

			expect(result).toBeErr();
			expect(vol.readFileSync("/downloads/manifest.json", "utf8")).toBe(manifestJson);
			expect(vol.readdirSync("/downloads/versions")).toEqual(["20260101T000000Z"]);
		});

		it("still allows a sources-filtered fetch in flat (non-versioned) mode", async () => {
			const factory = content({
				downloadPath: "downloads",
				tempPath: "temp",
				backupPath: "backups",
				sources: [
					defineSource({
						id: "a",
						fetch: () => [{ id: "doc", data: Promise.resolve({ from: "a" }) }],
					}),
					defineSource({
						id: "b",
						fetch: () => [{ id: "doc", data: Promise.resolve({ from: "b" }) }],
					}),
				],
			});
			const contentResult = await factory.setup(createMockPluginCtx());
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch", sources: ["a"] });

			expect(result).toBeOk();
			expect(vol.existsSync("/downloads/a/doc.json")).toBe(true);
			expect(vol.existsSync("/downloads/b/doc.json")).toBe(false);
		});
	});

	describe("transform system", () => {
		it("should run transforms in order", async () => {
			const order: string[] = [];

			const transform1: ContentTransform = {
				name: "transform1",
				apply: async () => {
					order.push("t1");
				},
			};
			const transform2: ContentTransform = {
				name: "transform2",
				apply: async () => {
					order.push("t2");
				},
			};

			const factory = content(createBasicConfig([transform1, transform2]));
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({ type: "content.fetch" });

			expect(order).toEqual(["t1", "t2"]);
		});

		it("should handle transform errors", async () => {
			const errorTransform: ContentTransform = {
				name: "error-transform",
				apply: async () => {
					throw new Error("transform failed");
				},
			};

			const factory = content(createBasicConfig([errorTransform]));
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch" });

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
			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
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

			const factory = content({
				...createBasicConfig(),
				sources: [slowSource],
			});
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// First command takes time
			const firstCommand = instance.executeCommand({
				type: "content.fetch",
			});

			// Try second command immediately (will be rejected because first is in progress)
			const secondCommand = instance.executeCommand({
				type: "content.fetch",
			});

			const [firstResult, secondResult] = await Promise.all([firstCommand, secondCommand]);

			expect(firstResult).toBeOk();
			expect(secondResult).toBeErr();
			expect(secondResult._unsafeUnwrapErr().message).toContain(
				"A command is already in progress.",
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

			const factory = content({
				...createBasicConfig(),
				sources: [slowSource],
			});
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// Start a fetch
			const fetchCommand = instance.executeCommand({
				type: "content.fetch",
			});

			// Try to execute clear while fetch is in progress
			const clearCommand = instance.executeCommand({
				type: "content.clear",
			});

			const [fetchResult, clearResult] = await Promise.all([fetchCommand, clearCommand]);

			expect(fetchResult).toBeOk();
			expect(clearResult).toBeErr();
			expect(clearResult._unsafeUnwrapErr().message).toContain("A command is already in progress.");
		});

		it("should allow sequential commands to execute after first completes", async () => {
			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result1 = await instance.executeCommand({
				type: "content.fetch",
			});

			expect(result1).toBeOk();

			const result2 = await instance.executeCommand({
				type: "content.fetch",
			});

			expect(result2).toBeOk();
		});

		describe("content.ack", () => {
			it("writes the lease file with the exact contract body", async () => {
				const factory = content({
					...createBasicConfig(),
					versioning: true,
				});
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({
					type: "content.ack",
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
				});

				expect(result).toBeOk();
				expect(vol.readFileSync(getAckFilePath("/downloads", "kiosk-1"), "utf8")).toBe(
					JSON.stringify({ versionId: "20260714T153045Z" }),
				);
			});

			it("renews an existing lease by bumping its mtime", async () => {
				const factory = content({
					...createBasicConfig(),
					versioning: true,
				});
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				await instance.executeCommand({
					type: "content.ack",
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
				});
				const ackPath = getAckFilePath("/downloads", "kiosk-1");
				const oldMtime = new Date("2026-07-14T15:00:00.000Z");
				vol.utimesSync(ackPath, oldMtime, oldMtime);

				const result = await instance.executeCommand({
					type: "content.ack",
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
				});

				expect(result).toBeOk();
				expect(vol.statSync(ackPath).mtime.getTime()).toBeGreaterThan(oldMtime.getTime());
			});

			it("rejects a missing consumerId with a clean command error", async () => {
				const factory = content({
					...createBasicConfig(),
					versioning: true,
				});
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({
					type: "content.ack",
					versionId: "20260714T153045Z",
				} as unknown as Parameters<typeof instance.executeCommand>[0]);

				expect(result).toBeErr();
				expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
			});

			it("rejects a missing versionId with a clean command error", async () => {
				const factory = content({
					...createBasicConfig(),
					versioning: true,
				});
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({
					type: "content.ack",
					consumerId: "kiosk-1",
				} as unknown as Parameters<typeof instance.executeCommand>[0]);

				expect(result).toBeErr();
				expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
			});

			it("rejects a hostile consumerId", async () => {
				const factory = content({
					...createBasicConfig(),
					versioning: true,
				});
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({
					type: "content.ack",
					consumerId: "../evil",
					versionId: "20260714T153045Z",
				});

				expect(result).toBeErr();
			});

			it("errors cleanly when versioning is off", async () => {
				const factory = content(createBasicConfig());
				const contentResult = await factory.setup(createMockPluginCtx());
				const instance = contentResult._unsafeUnwrap();

				const result = await instance.executeCommand({
					type: "content.ack",
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
				});

				expect(result).toBeErr();
				expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentError);
			});
		});

		it("should report restored state accurately when backups are unavailable", async () => {
			const rootTransform: ContentTransform = {
				name: "failing-transform",
				apply: async () => {
					throw new Error("transform failed");
				},
			};

			const ctx = createMockPluginCtx();
			const factory = content({
				...createBasicConfig([rootTransform]),
				backupAndRestore: false,
			});
			const contentResult = await factory.setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({ type: "content.fetch" });

			expect(result).toBeErr();
			type MinimalSourceState = { restored?: boolean };
			type MinimalContentState = {
				phase?: string;
				restored?: boolean;
				sources: Record<string, MinimalSourceState>;
			};
			const stateUpdates: MinimalContentState[] = [];
			for (const call of ctx.updateState.mock.calls) {
				const producer = call[0] as (draft: MinimalContentState) => void;
				const draft: MinimalContentState = {
					phase: "idle",
					restored: false,
					sources: { test: { restored: false } },
				};
				producer(draft);
				stateUpdates.push(draft);
			}
			const errorStates = stateUpdates.filter((update) => update.phase === "error");
			expect(errorStates.at(-1)?.restored).toBe(false);
		});

		it("should clear staged run directories when content.clear is called with temp", async () => {
			vol.mkdirSync("/temp/runs/run-a/downloads/test", { recursive: true });
			vol.mkdirSync("/temp/runs/run-b/media-downloader/test", { recursive: true });
			vol.writeFileSync("/temp/runs/run-a/downloads/test/doc1.json", "{}");
			vol.writeFileSync("/temp/runs/run-b/media-downloader/test/file.jpg", "img");

			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.clear",
				temp: true,
				downloads: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/run-a")).toBe(false);
			expect(vol.existsSync("/temp/runs/run-b")).toBe(false);
		});

		it("should reject malformed commands during runtime validation", async () => {
			const factory = content(createBasicConfig());
			const contentResult = await factory.setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
				sources: [123],
			} as unknown as Parameters<typeof instance.executeCommand>[0]);

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("Invalid command:");
		});
	});
});
