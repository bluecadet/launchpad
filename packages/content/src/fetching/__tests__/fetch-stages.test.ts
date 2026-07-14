import path from "node:path";
import { vol } from "memfs";
import { errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentError } from "../../content-transform.js";
import * as ManifestUtils from "../../manifest.js";
import { defineSource } from "../../source.js";
import * as FileUtils from "../../utils/file-utils.js";
import {
	backupStage,
	ContentFetchError,
	ContentRecoveryError,
	cleanupStage,
	clearOldDataStage,
	errorRecoveryStage,
	fetchSourcesStage,
	finalizingStage,
	runTransformsStage,
} from "../fetch-stages.js";
import {
	createMockContentConfig,
	createMockDataStore,
	createMockFetchContext,
} from "./fetch-test-utils.js";

describe("Fetch Stages", () => {
	beforeEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	describe("backupStage", () => {
		it("should skip backup when backupAndRestore is false", async () => {
			const context = createMockFetchContext({
				config: createMockContentConfig({ backupAndRestore: false }),
			});

			const result = await backupStage(context);

			expect(result).toBeOk();
			expect(context.logger.info).not.toHaveBeenCalledWith(expect.stringContaining("Backing up"));
		});

		it("should skip backup for source with no downloads", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			const context = createMockFetchContext({
				config: createMockContentConfig({ backupAndRestore: true }),
				sources: [
					defineSource({
						id: "nonexistent",
						fetch: () => [],
					}),
				],
			});

			const result = await backupStage(context);

			expect(result).toBeOk();
			expect(context.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("No downloads found"),
			);
		});

		it("should backup existing downloads", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/file.json", '{"data":"test"}');

			const context = createMockFetchContext({
				config: createMockContentConfig({ backupAndRestore: true }),
				sources: [
					defineSource({
						id: "test",
						fetch: () => [],
					}),
				],
			});

			const result = await backupStage(context);

			expect(result).toBeOk();

			expect(vol.existsSync("/backups/test/file.json")).toBe(true);
			expect(vol.readFileSync("/backups/test/file.json", "utf8")).toBe('{"data":"test"}');
		});

		it("should skip backup when versioning is enabled, even if backupAndRestore is true", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/file.json", '{"data":"test"}');

			const context = createMockFetchContext({
				config: createMockContentConfig({
					backupAndRestore: true,
					versioning: { keep: 3, ackTimeout: 1_800_000 },
				}),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await backupStage(context);

			expect(result).toBeOk();
			expect(vol.existsSync("/backups/test/file.json")).toBe(false);
		});
	});

	describe("clearOldDataStage", () => {
		it("should prepare staged directories for all sources without mutating published content", async () => {
			vol.mkdirSync("/downloads/test1", { recursive: true });
			vol.mkdirSync("/downloads/test2", { recursive: true });
			vol.writeFileSync("/downloads/test1/old.json", "{}");
			vol.writeFileSync("/downloads/test2/old.json", "{}");

			const context = createMockFetchContext({
				sources: [
					defineSource({ id: "test1", fetch: () => [] }),
					defineSource({ id: "test2", fetch: () => [] }),
				],
			});

			const result = await clearOldDataStage(context);

			expect(result).toBeOk();
			expect(vol.existsSync("/downloads/test1/old.json")).toBe(true);
			expect(vol.existsSync("/downloads/test2/old.json")).toBe(true);
			expect(vol.existsSync("/temp/runs/test-run/downloads/test1/old.json")).toBe(false);
			expect(vol.existsSync("/temp/runs/test-run/downloads/test2/old.json")).toBe(false);
		});

		it("should seed keep-pattern files into staged directories", async () => {
			vol.mkdirSync("/downloads/test", { recursive: true });
			vol.writeFileSync("/downloads/test/.keep", "");
			vol.writeFileSync("/downloads/test/remove.json", "{}");

			const context = createMockFetchContext({
				config: createMockContentConfig({ keep: [".keep"] }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await clearOldDataStage(context);

			expect(result).toBeOk();
			expect(vol.existsSync("/downloads/test/.keep")).toBe(true);
			expect(vol.existsSync("/downloads/test/remove.json")).toBe(true);
			expect(vol.existsSync("/temp/runs/test-run/downloads/test/.keep")).toBe(true);
			expect(vol.existsSync("/temp/runs/test-run/downloads/test/remove.json")).toBe(false);
		});

		it("should handle missing published directories", async () => {
			const context = createMockFetchContext({
				sources: [defineSource({ id: "nonexistent", fetch: () => [] })],
			});

			const result = await clearOldDataStage(context);

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/test-run/downloads/nonexistent")).toBe(true);
		});

		describe("under versioning", () => {
			it("should seed each source from the manifest's active version, resolved via sources[].path", async () => {
				vol.mkdirSync("/downloads/versions/activeVersion/test1-dir", { recursive: true });
				vol.mkdirSync("/downloads/versions/activeVersion/test2-dir", { recursive: true });
				vol.writeFileSync("/downloads/versions/activeVersion/test1-dir/.keep", "");
				vol.writeFileSync("/downloads/versions/activeVersion/test2-dir/.keep", "");
				vol.writeFileSync(
					"/downloads/manifest.json",
					JSON.stringify({
						schemaVersion: 1,
						versionId: "activeVersion",
						versionPath: "versions/activeVersion",
						generatedAt: "2026-01-01T00:00:00.000Z",
						sources: [
							{ sourceId: "test1", path: "test1-dir" },
							{ sourceId: "test2", path: "test2-dir" },
						],
					}),
				);

				const context = createMockFetchContext({
					config: createMockContentConfig({
						keep: [".keep"],
						versioning: { keep: 3, ackTimeout: 1_800_000 },
					}),
					sources: [
						defineSource({ id: "test1", fetch: () => [] }),
						defineSource({ id: "test2", fetch: () => [] }),
					],
				});

				const result = await clearOldDataStage(context);

				expect(result).toBeOk();
				expect(vol.existsSync("/temp/runs/test-run/downloads/test1/.keep")).toBe(true);
				expect(vol.existsSync("/temp/runs/test-run/downloads/test2/.keep")).toBe(true);
			});

			it("should seed empty and warn when no manifest exists yet", async () => {
				vol.mkdirSync("/downloads", { recursive: true });

				const context = createMockFetchContext({
					config: createMockContentConfig({
						keep: [".keep"],
						versioning: { keep: 3, ackTimeout: 1_800_000 },
					}),
					sources: [defineSource({ id: "test", fetch: () => [] })],
				});

				const result = await clearOldDataStage(context);

				expect(result).toBeOk();
				expect(vol.existsSync("/temp/runs/test-run/downloads/test")).toBe(true);
				expect(vol.readdirSync("/temp/runs/test-run/downloads/test")).toEqual([]);
				expect(context.logger.warn).toHaveBeenCalledWith(
					expect.stringContaining("No manifest found"),
				);
			});

			it("should seed empty and warn when the manifest's version dir is missing", async () => {
				vol.mkdirSync("/downloads", { recursive: true });
				vol.writeFileSync(
					"/downloads/manifest.json",
					JSON.stringify({
						schemaVersion: 1,
						versionId: "goneVersion",
						versionPath: "versions/goneVersion",
						generatedAt: "2026-01-01T00:00:00.000Z",
						sources: [{ sourceId: "test", path: "test" }],
					}),
				);

				const context = createMockFetchContext({
					config: createMockContentConfig({
						keep: [".keep"],
						versioning: { keep: 3, ackTimeout: 1_800_000 },
					}),
					sources: [defineSource({ id: "test", fetch: () => [] })],
				});

				const result = await clearOldDataStage(context);

				expect(result).toBeOk();
				expect(vol.existsSync("/temp/runs/test-run/downloads/test")).toBe(true);
				expect(vol.readdirSync("/temp/runs/test-run/downloads/test")).toEqual([]);
				expect(context.logger.warn).toHaveBeenCalledWith(
					expect.stringContaining("Active version directory not found"),
				);
			});

			it("should seed empty and warn when the active version has no entry for a source", async () => {
				vol.mkdirSync("/downloads/versions/activeVersion", { recursive: true });
				vol.writeFileSync(
					"/downloads/manifest.json",
					JSON.stringify({
						schemaVersion: 1,
						versionId: "activeVersion",
						versionPath: "versions/activeVersion",
						generatedAt: "2026-01-01T00:00:00.000Z",
						sources: [{ sourceId: "other", path: "other" }],
					}),
				);

				const context = createMockFetchContext({
					config: createMockContentConfig({
						keep: [".keep"],
						versioning: { keep: 3, ackTimeout: 1_800_000 },
					}),
					sources: [defineSource({ id: "test", fetch: () => [] })],
				});

				const result = await clearOldDataStage(context);

				expect(result).toBeOk();
				expect(vol.existsSync("/temp/runs/test-run/downloads/test")).toBe(true);
				expect(vol.readdirSync("/temp/runs/test-run/downloads/test")).toEqual([]);
				expect(context.logger.warn).toHaveBeenCalledWith(
					expect.stringContaining("has no entry for source test"),
				);
			});

			it("should never seed from an orphan dir newer than the active version", async () => {
				vol.mkdirSync("/downloads/versions/activeVersion/test", { recursive: true });
				vol.writeFileSync("/downloads/versions/activeVersion/test/.keep", "active");
				vol.mkdirSync("/downloads/versions/zzz-newer-orphan/test", { recursive: true });
				vol.writeFileSync("/downloads/versions/zzz-newer-orphan/test/.keep", "orphan");
				vol.writeFileSync(
					"/downloads/manifest.json",
					JSON.stringify({
						schemaVersion: 1,
						versionId: "activeVersion",
						versionPath: "versions/activeVersion",
						generatedAt: "2026-01-01T00:00:00.000Z",
						sources: [{ sourceId: "test", path: "test" }],
					}),
				);

				const context = createMockFetchContext({
					config: createMockContentConfig({
						keep: [".keep"],
						versioning: { keep: 3, ackTimeout: 1_800_000 },
					}),
					sources: [defineSource({ id: "test", fetch: () => [] })],
				});

				const result = await clearOldDataStage(context);

				expect(result).toBeOk();
				expect(vol.readFileSync("/temp/runs/test-run/downloads/test/.keep", "utf8")).toBe("active");
			});
		});
	});

	describe("fetchSourcesStage", () => {
		it("should warn when no sources are configured", async () => {
			const context = createMockFetchContext({
				sources: [],
			});

			const result = await fetchSourcesStage(context);

			expect(result).toBeOk();
			expect(context.logger.warn).toHaveBeenCalledWith("No sources found to download");
		});

		it("should emit source:start and source:done events", async () => {
			const dataStore = createMockDataStore();
			vi.mocked(dataStore.createNamespace).mockReturnValue(okAsync({} as never));
			vi.mocked(dataStore.namespace).mockReturnValue(
				ok({
					asyncAndThen: vi.fn((cb) =>
						cb({
							insert: vi.fn(() => okAsync(undefined)),
						}),
					),
				} as never),
			);

			const context = createMockFetchContext({
				dataStore,
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			await fetchSourcesStage(context);

			const events = context.eventBus.getEmittedEvents();
			expect(events.some((e) => e.event === "content:source:start")).toBe(true);
			expect(events.some((e) => e.event === "content:source:done")).toBe(true);
		});
	});

	describe("runTransformsStage", () => {
		it("should skip when no transforms", async () => {
			const context = createMockFetchContext({ transforms: [] });
			const result = await runTransformsStage(context);
			expect(result).toBeOk();
		});

		it("should run transforms sequentially and emit events", async () => {
			const order: string[] = [];
			const context = createMockFetchContext({
				transforms: [
					{
						name: "t1",
						apply: async () => {
							order.push("t1");
						},
					},
					{
						name: "t2",
						apply: async () => {
							order.push("t2");
						},
					},
				],
			});

			const result = await runTransformsStage(context);

			expect(result).toBeOk();
			expect(order).toEqual(["t1", "t2"]);
			expect(context.eventBus.getEventsOfType("content:transform:start")).toHaveLength(2);
			expect(context.eventBus.getEventsOfType("content:transform:done")).toHaveLength(2);
		});

		it("should return error when a transform fails", async () => {
			const context = createMockFetchContext({
				transforms: [
					{
						name: "failing",
						apply: async () => {
							throw new Error("transform error");
						},
					},
				],
			});

			const result = await runTransformsStage(context);

			expect(result).toBeErr();
			expect(context.eventBus.getEventsOfType("content:transform:error")).toHaveLength(1);
		});
	});

	describe("finalizingStage", () => {
		it("should close data store", async () => {
			const context = createMockFetchContext();
			const result = await finalizingStage(context);

			expect(result).toBeOk();
			expect(context.dataStore.close).toHaveBeenCalled();
		});

		it("should promote staged output and emit fetch:done event", async () => {
			vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
			vol.mkdirSync("/temp/runs/test-run/downloads/source2", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');
			vol.writeFileSync("/temp/runs/test-run/downloads/source2/file.json", '{"id":2}');
			vol.mkdirSync("/downloads/source1", { recursive: true });
			vol.writeFileSync("/downloads/source1/old.json", "{} ");

			const context = createMockFetchContext({
				sources: [
					defineSource({ id: "source1", fetch: () => [] }),
					defineSource({ id: "source2", fetch: () => [] }),
				],
			});

			await finalizingStage(context);

			expect(vol.existsSync("/downloads/source1/file.json")).toBe(true);
			expect(vol.existsSync("/downloads/source1/old.json")).toBe(false);
			expect(vol.existsSync("/downloads/source2/file.json")).toBe(true);

			const doneEvent = context.eventBus.getEventsOfType("content:fetch:done")[0];
			expect(doneEvent).toEqual({
				sources: ["source1", "source2"],
			});
		});

		it("should promote staged root-level output", async () => {
			vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');
			vol.writeFileSync("/temp/runs/test-run/downloads/manifest.json", '{"version":1}');
			vol.mkdirSync("/downloads", { recursive: true });
			vol.writeFileSync("/downloads/manifest.json", '{"version":0}');

			const context = createMockFetchContext({
				sources: [defineSource({ id: "source1", fetch: () => [] })],
			});

			const result = await finalizingStage(context);

			expect(result).toBeOk();
			expect(vol.readFileSync("/downloads/manifest.json", "utf8")).toBe('{"version":1}');
		});

		it("should preserve published content if promotion fails", async () => {
			vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');
			vol.mkdirSync("/downloads/source1", { recursive: true });
			vol.writeFileSync("/downloads/source1/old.json", "stable");

			const originalReplacePath = FileUtils.replacePath;
			const replaceSpy = vi
				.spyOn(FileUtils, "replacePath")
				.mockImplementation((src, dest, options) => {
					if (src === "/temp/runs/test-run/downloads/source1") {
						return errAsync(new FileUtils.FileUtilsError("promotion failed"));
					}
					return originalReplacePath(src, dest, options);
				});

			try {
				const context = createMockFetchContext({
					sources: [defineSource({ id: "source1", fetch: () => [] })],
				});

				const result = await finalizingStage(context);

				expect(result).toBeErr();
				expect(vol.existsSync("/downloads/source1/old.json")).toBe(true);
				expect(vol.existsSync("/downloads/source1/file.json")).toBe(false);
			} finally {
				replaceSpy.mockRestore();
			}
		});

		it("should return error if data store close fails", async () => {
			const context = createMockFetchContext();
			vi.mocked(context.dataStore.close).mockReturnValue(errAsync(new Error("Close failed")));

			const result = await finalizingStage(context);

			expect(result).toBeErr();
		});

		describe("under versioning", () => {
			it("should move the staged root into versions/<versionId>, swap the manifest, and emit the promoted event after the swap", async () => {
				vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
				vol.mkdirSync("/temp/runs/test-run/downloads/source2", { recursive: true });
				vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');
				vol.writeFileSync("/temp/runs/test-run/downloads/source2/file.json", '{"id":2}');

				vol.mkdirSync("/downloads/versions/oldVersion/source1", { recursive: true });
				vol.writeFileSync("/downloads/versions/oldVersion/source1/file.json", '{"id":"old"}');
				vol.writeFileSync(
					"/downloads/manifest.json",
					JSON.stringify({
						schemaVersion: 1,
						versionId: "oldVersion",
						versionPath: "versions/oldVersion",
						generatedAt: "2026-01-01T00:00:00.000Z",
						sources: [{ sourceId: "source1", path: "source1" }],
					}),
				);

				const context = createMockFetchContext({
					config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
					sources: [
						defineSource({ id: "source1", fetch: () => [] }),
						defineSource({ id: "source2", fetch: () => [] }),
					],
				});

				const result = await finalizingStage(context);

				expect(result).toBeOk();

				const manifest = JSON.parse(vol.readFileSync("/downloads/manifest.json", "utf8") as string);
				expect(manifest.schemaVersion).toBe(1);
				expect(manifest.versionId).toMatch(/^\d{8}T\d{6}Z$/);
				expect(manifest.versionPath).toBe(`versions/${manifest.versionId}`);
				expect(manifest.sources).toEqual([
					{ sourceId: "source1", path: "source1" },
					{ sourceId: "source2", path: "source2" },
				]);

				expect(vol.existsSync(`/downloads/${manifest.versionPath}/source1/file.json`)).toBe(true);
				expect(vol.existsSync(`/downloads/${manifest.versionPath}/source2/file.json`)).toBe(true);

				// Previously active version is untouched
				expect(vol.readFileSync("/downloads/versions/oldVersion/source1/file.json", "utf8")).toBe(
					'{"id":"old"}',
				);

				const events = context.eventBus.getEmittedEvents();
				const promotedIndex = events.findIndex((e) => e.event === "content:version:promoted");
				const doneIndex = events.findIndex((e) => e.event === "content:fetch:done");
				expect(promotedIndex).toBeGreaterThanOrEqual(0);
				expect(doneIndex).toBeGreaterThan(promotedIndex);

				expect(events[promotedIndex].data).toEqual({
					versionId: manifest.versionId,
					versionPath: manifest.versionPath,
					generatedAt: manifest.generatedAt,
				});
			});

			it("should not delete the just-committed version if error recovery runs afterward for an unrelated failure", async () => {
				vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
				vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');

				const context = createMockFetchContext({
					config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
					sources: [defineSource({ id: "source1", fetch: () => [] })],
				});

				const result = await finalizingStage(context);
				expect(result).toBeOk();

				const manifestBefore = JSON.parse(
					vol.readFileSync("/downloads/manifest.json", "utf8") as string,
				);

				// Simulate a later, unrelated stage (e.g. cleanupStage) failing after promotion
				// already committed, which routes through the same error-recovery path.
				await errorRecoveryStage(context, new ContentError("unrelated later-stage failure"));

				expect(vol.existsSync(`/downloads/${manifestBefore.versionPath}/source1/file.json`)).toBe(
					true,
				);
				expect(JSON.parse(vol.readFileSync("/downloads/manifest.json", "utf8") as string)).toEqual(
					manifestBefore,
				);
			});

			it("should leave the active version and manifest untouched, and best-effort delete the orphan, when promotion fails before the swap", async () => {
				vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
				vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');

				vol.mkdirSync("/downloads/versions/oldVersion/source1", { recursive: true });
				vol.writeFileSync("/downloads/versions/oldVersion/source1/file.json", '{"id":"old"}');
				const originalManifestJson = JSON.stringify({
					schemaVersion: 1,
					versionId: "oldVersion",
					versionPath: "versions/oldVersion",
					generatedAt: "2026-01-01T00:00:00.000Z",
					sources: [{ sourceId: "source1", path: "source1" }],
				});
				vol.writeFileSync("/downloads/manifest.json", originalManifestJson);

				const moveSpy = vi
					.spyOn(FileUtils, "move")
					.mockReturnValue(errAsync(new FileUtils.FileUtilsError("promotion failed")));

				try {
					const context = createMockFetchContext({
						config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
						sources: [defineSource({ id: "source1", fetch: () => [] })],
					});

					const result = await finalizingStage(context);
					expect(result).toBeErr();

					expect(vol.readFileSync("/downloads/manifest.json", "utf8")).toBe(originalManifestJson);
					expect(vol.readFileSync("/downloads/versions/oldVersion/source1/file.json", "utf8")).toBe(
						'{"id":"old"}',
					);

					const error = result._unsafeUnwrapErr();
					const recovery = await errorRecoveryStage(context, error);
					expect(recovery).toBeOk();
					expect(recovery._unsafeUnwrap().restoredSourceIds).toEqual([]);
					expect(vol.existsSync(context.attemptedVersionPath as string)).toBe(false);
				} finally {
					moveSpy.mockRestore();
				}
			});

			it("should leave an orphan dir and nothing else when the crash happens between the move and the manifest swap", async () => {
				vol.mkdirSync("/temp/runs/test-run/downloads/source1", { recursive: true });
				vol.writeFileSync("/temp/runs/test-run/downloads/source1/file.json", '{"id":1}');

				vol.mkdirSync("/downloads/versions/oldVersion/source1", { recursive: true });
				vol.writeFileSync("/downloads/versions/oldVersion/source1/file.json", '{"id":"old"}');
				const originalManifestJson = JSON.stringify({
					schemaVersion: 1,
					versionId: "oldVersion",
					versionPath: "versions/oldVersion",
					generatedAt: "2026-01-01T00:00:00.000Z",
					sources: [{ sourceId: "source1", path: "source1" }],
				});
				vol.writeFileSync("/downloads/manifest.json", originalManifestJson);

				const writeManifestSpy = vi
					.spyOn(ManifestUtils, "writeManifest")
					.mockReturnValue(errAsync(new ManifestUtils.ManifestError("simulated crash")));

				try {
					const context = createMockFetchContext({
						config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
						sources: [defineSource({ id: "source1", fetch: () => [] })],
					});

					const result = await finalizingStage(context);
					expect(result).toBeErr();

					// Active version and manifest are untouched
					expect(vol.readFileSync("/downloads/manifest.json", "utf8")).toBe(originalManifestJson);
					expect(vol.readFileSync("/downloads/versions/oldVersion/source1/file.json", "utf8")).toBe(
						'{"id":"old"}',
					);

					// The move completed (orphan dir left behind); recovery never ran
					const orphanPath = context.attemptedVersionPath as string;
					expect(vol.existsSync(orphanPath)).toBe(true);
					expect(vol.existsSync(path.join(orphanPath, "source1", "file.json"))).toBe(true);

					const versionDirs = vol.readdirSync("/downloads/versions");
					expect(versionDirs.sort()).toEqual(["oldVersion", path.basename(orphanPath)].sort());
				} finally {
					writeManifestSpy.mockRestore();
				}
			});
		});
	});

	describe("errorRecoveryStage", () => {
		it("should emit fetch:error event", async () => {
			const context = createMockFetchContext();
			const error = new ContentError("Test error");

			await errorRecoveryStage(context, error);

			const errorEvent = context.eventBus.getEventsOfType("content:fetch:error")[0];
			expect(errorEvent).toEqual({ error });
		});

		it("should restore from backup when available", async () => {
			vol.mkdirSync("/backups/test", { recursive: true });
			vol.writeFileSync("/backups/test/file.json", '{"backup":"data"}');

			const context = createMockFetchContext({
				config: createMockContentConfig({ backupAndRestore: true }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const error = new ContentError("Test error");
			const result = await errorRecoveryStage(context, error);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap().restoredSourceIds).toEqual(["test"]);
			expect(vol.existsSync("/downloads/test/file.json")).toBe(true);
		});

		it("should warn when no backup exists", async () => {
			const context = createMockFetchContext({
				config: createMockContentConfig({ backupAndRestore: true }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const error = new ContentError("Test error");
			const result = await errorRecoveryStage(context, error);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap().restoredSourceIds).toEqual([]);
			expect(context.logger.warn).toHaveBeenCalledWith(expect.stringContaining("No backup found"));
		});

		it("should return ContentRecoveryError when restore fails", async () => {
			vol.mkdirSync("/backups/test", { recursive: true });
			vol.writeFileSync("/backups/test/file.json", '{"backup":"data"}');

			const originalCopy = FileUtils.copy;
			const copySpy = vi.spyOn(FileUtils, "copy").mockImplementation((src, dest, options) => {
				if (src === "/backups/test" && dest === "/downloads/test") {
					return errAsync(new FileUtils.FileUtilsError("restore failed"));
				}
				return originalCopy(src, dest, options);
			});

			try {
				const context = createMockFetchContext({
					config: createMockContentConfig({ backupAndRestore: true }),
					sources: [defineSource({ id: "test", fetch: () => [] })],
				});

				const originalError = new ContentError("Original error");
				const result = await errorRecoveryStage(context, originalError);

				expect(result).toBeErr();
				expect(result._unsafeUnwrapErr()).toBeInstanceOf(ContentRecoveryError);
			} finally {
				copySpy.mockRestore();
			}
		});

		it("should skip restore and best-effort delete the orphaned version dir under versioning", async () => {
			vol.mkdirSync("/downloads/versions/newVersion/test", { recursive: true });
			vol.writeFileSync("/downloads/versions/newVersion/test/file.json", "{}");

			const context = createMockFetchContext({
				config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});
			context.attemptedVersionPath = "/downloads/versions/newVersion";

			const error = new ContentError("Test error");
			const result = await errorRecoveryStage(context, error);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap().restoredSourceIds).toEqual([]);
			expect(vol.existsSync("/downloads/versions/newVersion")).toBe(false);
		});

		it("should log a warning and continue when the orphaned version dir can't be removed", async () => {
			const context = createMockFetchContext({
				config: createMockContentConfig({ versioning: { keep: 3, ackTimeout: 1_800_000 } }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});
			context.attemptedVersionPath = "/downloads/versions/newVersion";

			const removeSpy = vi
				.spyOn(FileUtils, "remove")
				.mockReturnValue(errAsync(new FileUtils.FileUtilsError("locked")));

			try {
				const result = await errorRecoveryStage(context, new ContentError("Test error"));

				expect(result).toBeOk();
				expect(result._unsafeUnwrap().restoredSourceIds).toEqual([]);
				expect(context.logger.warn).toHaveBeenCalledWith(
					expect.stringContaining("Failed to remove orphaned version directory"),
				);
			} finally {
				removeSpy.mockRestore();
			}
		});
	});

	describe("cleanupStage", () => {
		it("should skip cleanup when no options provided", async () => {
			vol.mkdirSync("/temp/test", { recursive: true });
			vol.mkdirSync("/backups/test", { recursive: true });

			const context = createMockFetchContext({
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await cleanupStage(context);

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/test")).toBe(true);
			expect(vol.existsSync("/backups/test")).toBe(true);
		});

		it("should clean temp directories when cleanup.temp is true", async () => {
			vol.mkdirSync("/temp/runs/test-run/test", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/test/file.tmp", "");

			const context = createMockFetchContext({
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await cleanupStage(context, { temp: true });

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/test-run/test/file.tmp")).toBe(false);
		});

		it("should clean backup directories when cleanup.backups is true", async () => {
			vol.mkdirSync("/backups/test", { recursive: true });
			vol.writeFileSync("/backups/test/file.json", "{}");

			const context = createMockFetchContext({
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await cleanupStage(context, { backups: true });

			expect(result).toBeOk();
			expect(vol.existsSync("/backups/test/file.json")).toBe(false);
		});

		it("should remove empty directories when removeIfEmpty is true", async () => {
			vol.mkdirSync("/temp/runs/test-run/test", { recursive: true });

			const context = createMockFetchContext({
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await cleanupStage(context, { temp: true, backups: true });

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/test-run")).toBe(false);
		});

		it("should ignore keep patterns during cleanup", async () => {
			vol.mkdirSync("/temp/runs/test-run/test", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/test/.keep", "");
			vol.writeFileSync("/temp/runs/test-run/test/file.tmp", "");

			const context = createMockFetchContext({
				config: createMockContentConfig({ keep: [".keep"] }),
				sources: [defineSource({ id: "test", fetch: () => [] })],
			});

			const result = await cleanupStage(context, { temp: true });

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/test-run/test/.keep")).toBe(false);
		});

		it("should handle multiple sources", async () => {
			vol.mkdirSync("/temp/runs/test-run/test1", { recursive: true });
			vol.mkdirSync("/temp/runs/test-run/test2", { recursive: true });
			vol.writeFileSync("/temp/runs/test-run/test1/file.tmp", "");
			vol.writeFileSync("/temp/runs/test-run/test2/file.tmp", "");

			const context = createMockFetchContext({
				sources: [
					defineSource({ id: "test1", fetch: () => [] }),
					defineSource({ id: "test2", fetch: () => [] }),
				],
			});

			const result = await cleanupStage(context, { temp: true });

			expect(result).toBeOk();
			expect(vol.existsSync("/temp/runs/test-run/test1/file.tmp")).toBe(false);
			expect(vol.existsSync("/temp/runs/test-run/test2/file.tmp")).toBe(false);
		});
	});

	describe("Error classes", () => {
		it("should create ContentFetchError with sourceId", () => {
			const error = new ContentFetchError("Test error", "source1");
			expect(error.message).toBe("Test error");
			expect(error.sourceId).toBe("source1");
			expect(error.name).toBe("ContentFetchError");
		});

		it("should create ContentFetchError with cause", () => {
			const cause = new Error("Original error");
			const error = new ContentFetchError("Test error", "source1", cause);
			expect(error.cause).toBe(cause);
		});

		it("should create ContentRecoveryError with originalError", () => {
			const originalError = new ContentError("Original");
			const error = new ContentRecoveryError("Recovery failed", originalError);
			expect(error.message).toBe("Recovery failed");
			expect(error.originalError).toBe(originalError);
			expect(error.name).toBe("ContentRecoveryError");
		});
	});
});
