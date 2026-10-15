import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactCache } from "../cache/artifact-cache.js";
import type { ContentConfig } from "../content-config.js";
import { content } from "../launchpad-content.js";
import { readManifest, writeManifest } from "../manifest.js";
import { defineSource } from "../source.js";
import { Document } from "../utils/data-store.js";
import * as FileUtils from "../utils/file-utils.js";
import { getProjectCachePaths } from "../utils/paths-helper.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("artifact cache publication lifecycle (real files and SQLite)", () => {
	let directory: string;
	let generations: Map<string, number>;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-cache-lifecycle-"));
		generations = new Map();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(directory, { recursive: true, force: true });
	});

	async function setup(overrides: Partial<ContentConfig> = {}) {
		const ctx = createMockPluginCtx(directory);
		const result = await content({
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			backupAndRestore: false,
			sources: ["a", "b"].map((id) =>
				defineSource({
					id,
					fetch: () => [{ id: "doc", data: Promise.resolve({ stable: true }) }],
				}),
			),
			transforms: [
				{
					name: "custom-artifact",
					apply: async ({ cache, paths }) => {
						for (const sourceId of ["a", "b"]) {
							await cache.derive({
								sourceId,
								namespace: "custom-artifact",
								version: "1",
								inputs: [path.join(paths.getDownloadPath(sourceId), "doc.json")],
								options: { quality: 90 },
								outputs: ["result.txt"],
								generate: async () => {
									generations.set(sourceId, (generations.get(sourceId) ?? 0) + 1);
									await writeFile(
										path.join(paths.getDownloadPath(sourceId), "result.txt"),
										"generated",
									);
								},
							});
						}
					},
				},
			],
			...overrides,
		}).setup(ctx);
		expect(result).toBeOk();
		return { instance: result._unsafeUnwrap(), ctx };
	}

	it("shares one cache across transforms, commits after cleanup, and reuses on the next run", async () => {
		const commits = vi.spyOn(ArtifactCache.prototype, "commitPublication");
		const { instance } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(commits).toHaveBeenCalledTimes(1);
		expect(await FileUtils.listDir(path.join(directory, "temp/runs"))).toEqual(
			expect.objectContaining({ value: [] }),
		);
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 1],
				["b", 1],
			]),
		);
	});

	it("cache-only clear selects sources; temp/backup clear leaves metadata intact", async () => {
		const { instance } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const database = getProjectCachePaths(directory).database;
		expect(await stat(database)).toBeDefined();
		expect(
			await instance.executeCommand({
				type: "content.clear",
				downloads: false,
				temp: true,
				backups: true,
			}),
		).toBeOk();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations.get("a")).toBe(1);
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["a"],
				downloads: false,
				cache: true,
			}),
		).toBeOk();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"generated",
		);
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 2],
				["b", 1],
			]),
		);
		expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeOk();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 3],
				["b", 1],
			]),
		);
	});

	it("does not commit provisional metadata after late cleanup failure and flat restore", async () => {
		const { instance } = await setup({ backupAndRestore: true });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const commits = vi.spyOn(ArtifactCache.prototype, "commitPublication");
		const originalReplace = FileUtils.replacePath;
		const modifiedSources = new Set<string>();
		const replace = vi
			.spyOn(FileUtils, "replacePath")
			.mockImplementation((source, target, options) => {
				if (path.basename(path.dirname(source)) !== "downloads") {
					return originalReplace(source, target, options);
				}
				return FileUtils.saveJson(
					"new published bytes",
					path.join(source, "result.txt"),
					false,
				).andThen(() => {
					modifiedSources.add(source);
					return originalReplace(source, target, options);
				});
			});
		const originalClear = FileUtils.remove;
		let failed = false;
		const clear = vi.spyOn(FileUtils, "remove").mockImplementation((target, options) => {
			if (!failed && path.dirname(target) === path.join(directory, "temp", "runs")) {
				failed = true;
				return errAsync(new FileUtils.FileUtilsError("late cleanup failure"));
			}
			return originalClear(target, options);
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(failed).toBe(true);
		expect(modifiedSources.size).toBe(2);
		expect(commits).not.toHaveBeenCalled();
		for (const sourceId of ["a", "b"]) {
			expect(
				await readFile(path.join(directory, "downloads", sourceId, "result.txt"), "utf8"),
			).toBe("generated");
		}
		replace.mockRestore();
		clear.mockRestore();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 2],
				["b", 2],
			]),
		);
	});

	it("uses a version manifest snapshot for reuse, and keeps a swapped version on late failure", async () => {
		const { instance } = await setup({ versioning: { keepVersions: 3 } });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const originalDerive = ArtifactCache.prototype.derive;
		let swapped = false;
		const derive = vi.spyOn(ArtifactCache.prototype, "derive").mockImplementation(async function (
			this: ArtifactCache,
			artifact,
		) {
			if (!swapped) {
				swapped = true;
				const active = await readManifest(path.join(directory, "downloads"));
				if (active.status !== "ok") throw new Error("Missing manifest");
				await writeManifest(path.join(directory, "downloads"), {
					...active.manifest,
					versionPath: "versions/missing",
				});
			}
			return originalDerive.call(this, artifact);
		});
		const originalClear = FileUtils.remove;
		let failed = false;
		vi.spyOn(FileUtils, "remove").mockImplementation((target, options) => {
			if (!failed && path.dirname(target) === path.join(directory, "temp", "runs")) {
				failed = true;
				return errAsync(new FileUtils.FileUtilsError("late cleanup failure"));
			}
			return originalClear(target, options);
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(failed).toBe(true);
		expect(swapped).toBe(true);
		expect(generations).toEqual(
			new Map([
				["a", 1],
				["b", 1],
			]),
		);
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		expect(
			await readFile(
				path.join(directory, "downloads", active.manifest.versionPath, "a/result.txt"),
				"utf8",
			),
		).toBe("generated");
		derive.mockRestore();
	});

	it("runs safely uncached with a corrupt DB, then discards it before future reuse", async () => {
		await mkdir(getProjectCachePaths(directory).directory, { recursive: true });
		await writeFile(getProjectCachePaths(directory).database, "corrupt database");
		const { instance, ctx } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(ctx.logger.warn).toHaveBeenCalled();
		expect(await stat(getProjectCachePaths(directory).untrusted)).toBeDefined();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 2],
				["b", 2],
			]),
		);
	});

	it("fails before publication if an unavailable DB cannot write a durable marker", async () => {
		const cachePaths = getProjectCachePaths(directory);
		await mkdir(cachePaths.directory, { recursive: true });
		await writeFile(cachePaths.database, "corrupt database");
		await mkdir(path.join(directory, "downloads/a"), { recursive: true });
		await writeFile(path.join(directory, "downloads/a/result.txt"), "previous bytes");
		const { instance } = await setup({
			backupAndRestore: true,
			transforms: [
				{
					name: "block-marker",
					apply: async () => {
						await mkdir(cachePaths.untrusted);
					},
				},
			],
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"previous bytes",
		);
	});

	it("refuses publication if unawaited accepted derive work fails", async () => {
		await mkdir(path.join(directory, "downloads/a"), { recursive: true });
		await writeFile(path.join(directory, "downloads/a/result.txt"), "previous bytes");
		const { instance } = await setup({
			backupAndRestore: true,
			transforms: [
				{
					name: "background-failure",
					apply: async ({ cache }) => {
						void cache
							.derive({
								sourceId: "a",
								namespace: "background",
								version: "1",
								inputs: [],
								options: {},
								outputs: ["result.txt"],
								generate: async () => {
									throw new Error("background generation failed");
								},
							})
							.catch(() => undefined);
					},
				},
			],
		});
		const result = await instance.executeCommand({ type: "content.fetch" });
		expect(result).toBeErr();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"previous bytes",
		);
		await expect(stat(getProjectCachePaths(directory).untrusted)).rejects.toThrow();
	});

	it("rejects source-path traversal in configuration, clear commands, and custom cache declarations", async () => {
		const invalid = await content({
			sources: [defineSource({ id: "../escape", fetch: () => [] })],
		}).setup(createMockPluginCtx(directory));
		expect(invalid).toBeErr();
		const { instance } = await setup();
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["../escape"],
				downloads: false,
				cache: true,
			}),
		).toBeErr();
		const custom = await setup({
			transforms: [
				{
					name: "invalid-source",
					apply: async ({ cache }) => {
						await cache.derive({
							sourceId: "../escape",
							namespace: "invalid",
							version: "1",
							inputs: [],
							options: {},
							outputs: ["result.txt"],
							generate: async () => undefined,
						});
					},
				},
			],
		});
		expect(await custom.instance.executeCommand({ type: "content.fetch" })).toBeErr();
	});

	it("clears selected active-version source bytes and keeps other sources intact", async () => {
		const { instance } = await setup({ versioning: true });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeOk();
		const versionRoot = path.join(directory, "downloads", active.manifest.versionPath);
		await expect(stat(path.join(versionRoot, "a/result.txt"))).rejects.toThrow();
		expect(await readFile(path.join(versionRoot, "b/result.txt"), "utf8")).toBe("generated");
	});

	it("does not restore partial backups or invalidate trusted metadata before publication", async () => {
		const { instance } = await setup({ backupAndRestore: true });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const originalCopy = FileUtils.copy;
		const copy = vi.spyOn(FileUtils, "copy").mockImplementation((source, target, options) => {
			if (target === path.join(directory, "backups/a")) {
				return originalCopy(source, target, options).andThen(() => {
					return FileUtils.remove(path.join(target, "result.txt")).andThen(() =>
						errAsync(new FileUtils.FileUtilsError("partial backup failure")),
					);
				});
			}
			return originalCopy(source, target, options);
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"generated",
		);
		copy.mockRestore();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 1],
				["b", 1],
			]),
		);
	});

	it("keeps affected metadata unsafe after partially failed promotion and interrupted restore", async () => {
		const { instance } = await setup({ backupAndRestore: true });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const originalReplace = FileUtils.replacePath;
		const replace = vi
			.spyOn(FileUtils, "replacePath")
			.mockImplementation((source, target, options) => {
				if (target === path.join(directory, "downloads/b")) {
					return errAsync(new FileUtils.FileUtilsError("partial promotion failure"));
				}
				return originalReplace(source, target, options);
			});
		const originalCopy = FileUtils.copy;
		const copy = vi.spyOn(FileUtils, "copy").mockImplementation((source, target, options) => {
			if (source === path.join(directory, "backups/a")) {
				return errAsync(new FileUtils.FileUtilsError("restore preparation interrupted"));
			}
			return originalCopy(source, target, options);
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"generated",
		);
		expect(await readFile(path.join(directory, "backups/a/result.txt"), "utf8")).toBe("generated");
		expect(await readFile(path.join(directory, "backups/b/result.txt"), "utf8")).toBe("generated");
		expect(await readdir(path.join(directory, "temp/runs"))).not.toEqual([]);
		const database = new DatabaseSync(getProjectCachePaths(directory).database);
		try {
			expect(
				database.prepare("SELECT source_id FROM unsafe_sources ORDER BY source_id").all(),
			).toEqual([{ source_id: "a" }, { source_id: "b" }]);
		} finally {
			database.close();
		}
		replace.mockRestore();
		copy.mockRestore();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toEqual(
			new Map([
				["a", 2],
				["b", 2],
			]),
		);
	});

	it("keeps active and historical versions when clear names an unregistered source", async () => {
		const { instance } = await setup({ versioning: { keepVersions: 3 } });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const versions = await readdir(path.join(directory, "downloads/versions"));
		expect(versions).toHaveLength(2);
		expect(
			await instance.executeCommand({ type: "content.clear", sources: ["versions"] }),
		).toBeErr();
		for (const version of versions) {
			expect(
				await readFile(path.join(directory, "downloads/versions", version, "a/result.txt"), "utf8"),
			).toBe("generated");
		}
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		await writeManifest(path.join(directory, "downloads"), {
			...active.manifest,
			sources: active.manifest.sources.filter((source) => source.sourceId !== "a"),
		});
		expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeOk();
		for (const version of versions) {
			expect(
				await readFile(path.join(directory, "downloads/versions", version, "a/result.txt"), "utf8"),
			).toBe("generated");
		}
	});

	it.each([
		{ versionPath: "../../outside", sourcePath: "a" },
		{ versionPath: "/outside", sourcePath: "a" },
		{ versionPath: "versions/../outside", sourcePath: "a" },
		{ versionPath: "versions/safe", sourcePath: "../../../outside" },
		{ versionPath: "versions/safe", sourcePath: "C:/outside" },
		{ versionPath: "versions/safe", sourcePath: "..\\outside" },
		{ versionPath: "versions/safe", sourcePath: "." },
	])("rejects malicious manifest clear paths: %j", async ({ versionPath, sourcePath }) => {
		const { instance } = await setup({ versioning: { keepVersions: 3 } });
		// Clear needs real version roots and a manifest, not the fetch/publication pipeline.
		for (const version of ["historical", "active"]) {
			const sourceRoot = path.join(directory, "downloads/versions", version, "a");
			await mkdir(sourceRoot, { recursive: true });
			await writeFile(path.join(sourceRoot, "result.txt"), "generated");
		}
		expect(
			await writeManifest(path.join(directory, "downloads"), {
				schemaVersion: 1,
				versionId: "active",
				versionPath: "versions/active",
				generatedAt: new Date(0).toISOString(),
				sources: [{ sourceId: "a", path: "a" }],
			}),
		).toBeOk();
		await mkdir(path.join(directory, "outside"));
		await writeFile(path.join(directory, "outside/sentinel"), "untouched");
		const versions = await readdir(path.join(directory, "downloads/versions"));
		expect(versions).toHaveLength(2);
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		await writeFile(
			path.join(directory, "downloads/manifest.json"),
			JSON.stringify({
				...active.manifest,
				versionPath,
				sources: [{ sourceId: "a", path: sourcePath }],
			}),
		);
		expect((await readManifest(path.join(directory, "downloads"))).status).toBe("invalid");
		expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeErr();
		expect(await readFile(path.join(directory, "outside/sentinel"), "utf8")).toBe("untouched");
		for (const version of versions) {
			expect(
				await readFile(path.join(directory, "downloads/versions", version, "a/result.txt"), "utf8"),
			).toBe("generated");
		}
	});

	it.each([true, false])(
		"rejects manifest source aliases rather than clearing another source (overlap: %s)",
		async (includeOther) => {
			const { instance } = await setup({ versioning: true });
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			const active = await readManifest(path.join(directory, "downloads"));
			if (active.status !== "ok") throw new Error("Missing manifest");
			await writeFile(
				path.join(directory, "downloads/manifest.json"),
				JSON.stringify({
					...active.manifest,
					sources: includeOther
						? [
								{ sourceId: "a", path: "b" },
								{ sourceId: "b", path: "b" },
							]
						: [{ sourceId: "a", path: "b" }],
				}),
			);
			expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeErr();
			for (const sourceId of ["a", "b"]) {
				expect(
					await readFile(
						path.join(directory, "downloads", active.manifest.versionPath, sourceId, "result.txt"),
						"utf8",
					),
				).toBe("generated");
			}
		},
	);

	it("rejects symlinked manifest source paths for clear and previous-root cache lookup", async () => {
		const { instance } = await setup({ versioning: true });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		await mkdir(path.join(directory, "outside"));
		await writeFile(path.join(directory, "outside/sentinel"), "untouched");
		const versionRoot = path.join(directory, "downloads", active.manifest.versionPath);
		await rename(path.join(versionRoot, "a"), path.join(versionRoot, "a-real"));
		await symlink(path.join(directory, "outside"), path.join(versionRoot, "a"));
		expect(await instance.executeCommand({ type: "content.clear", sources: ["a"] })).toBeErr();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(await readFile(path.join(directory, "outside/sentinel"), "utf8")).toBe("untouched");
		expect(
			await readFile(
				path.join(directory, "downloads", active.manifest.versionPath, "a-real/result.txt"),
				"utf8",
			),
		).toBe("generated");
	});

	it("drains started sources and closes documents before releasing the lease after a synchronous source throw", async () => {
		let complete: ((data: unknown) => void) | undefined;
		let started: (() => void) | undefined;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const pending = new Promise<unknown>((resolve) => {
			complete = resolve;
		});
		const first = await setup({
			sources: [
				defineSource({
					id: "a",
					fetch: () => {
						started?.();
						return [{ id: "gated", data: pending }];
					},
				}),
				defineSource({
					id: "b",
					fetch: () => {
						throw new Error("synchronous source failure");
					},
				}),
			],
			transforms: [],
		});
		const second = await setup();
		const closed = vi.spyOn(Document.prototype, "close");
		const fetch = first.instance.executeCommand({ type: "content.fetch" });
		await ready;
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(
			await second.instance.executeCommand({
				type: "content.clear",
				downloads: false,
				cache: true,
			}),
		).toBeErr();
		complete?.({ finished: true });
		expect(await fetch).toBeErr();
		expect(closed).toHaveBeenCalledTimes(1);
		const closedDocument = closed.mock.contexts[0];
		if (!(closedDocument instanceof Document)) throw new Error("Missing closed document");
		await expect(closedDocument._read()).rejects.toThrow();
		expect(await readdir(path.join(directory, "temp/runs"))).toEqual([]);
		expect(await second.instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(await readdir(path.join(directory, "temp/runs"))).toEqual([]);
	});

	it("routes a synchronous transform throw through document closure and non-destructive recovery", async () => {
		await mkdir(path.join(directory, "downloads/a"), { recursive: true });
		await writeFile(path.join(directory, "downloads/a/result.txt"), "previous bytes");
		const closed = vi.spyOn(Document.prototype, "close");
		const { instance } = await setup({
			backupAndRestore: true,
			transforms: [
				{
					name: "sync-failure",
					apply: () => {
						throw new Error("synchronous transform failure");
					},
				},
			],
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(closed).toHaveBeenCalledTimes(2);
		for (const document of closed.mock.contexts) {
			if (!(document instanceof Document)) throw new Error("Missing closed document");
			await expect(document._read()).rejects.toThrow();
		}
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"previous bytes",
		);
		expect(await readdir(path.join(directory, "temp/runs"))).toEqual([]);
	});

	it("clears only selected source temporary files, including run and transform namespaces", async () => {
		const { instance } = await setup();
		for (const root of [
			"temp",
			"temp/custom-artifact",
			"temp/runs/old/downloads",
			"temp/runs/old/custom-artifact",
		]) {
			for (const sourceId of ["a", "b"]) {
				await mkdir(path.join(directory, root, sourceId), { recursive: true });
				await writeFile(path.join(directory, root, sourceId, "sentinel"), sourceId);
			}
		}
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["a"],
				downloads: false,
				temp: true,
			}),
		).toBeOk();
		for (const root of [
			"temp",
			"temp/custom-artifact",
			"temp/runs/old/downloads",
			"temp/runs/old/custom-artifact",
		]) {
			await expect(stat(path.join(directory, root, "a/sentinel"))).rejects.toThrow();
			expect(await readFile(path.join(directory, root, "b/sentinel"), "utf8")).toBe("b");
		}
	});

	it.each(["tempPath", "downloadPath", "backupPath"] as const)(
		"rejects unsafe %s before clearing lease or metadata",
		async (configuredPath) => {
			const { instance } = await setup();
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			const protectedPaths = getProjectCachePaths(directory);
			const database = new DatabaseSync(protectedPaths.database);
			try {
				expect(
					database.prepare("SELECT source_id FROM artifacts ORDER BY source_id").all(),
				).toEqual([{ source_id: "a" }, { source_id: "b" }]);
			} finally {
				database.close();
			}
			const lockBefore = await stat(protectedPaths.lock);
			const databaseBefore = await readFile(protectedPaths.database);
			const unsafe = await content({
				[configuredPath]: ".launchpad",
				sources: [defineSource({ id: "a", fetch: () => [] })],
			}).setup(createMockPluginCtx(directory));
			expect(unsafe).toBeErr();
			expect((await stat(protectedPaths.lock)).ino).toBe(lockBefore.ino);
			expect(await readFile(protectedPaths.database)).toEqual(databaseBefore);
		},
	);

	it("rejects a second plugin writer even with another output root, and releases the permanent lease", async () => {
		let complete: (() => void) | undefined;
		let started: (() => void) | undefined;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const pending = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const first = await setup({
			transforms: [
				{
					name: "blocked",
					apply: async () => {
						started?.();
						await pending;
					},
				},
			],
		});
		const second = await setup({ downloadPath: "other-downloads" });
		const fetch = first.instance.executeCommand({ type: "content.fetch" });
		await ready;
		expect(await second.instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(
			await second.instance.executeCommand({
				type: "content.clear",
				downloads: false,
				cache: true,
			}),
		).toBeErr();
		complete?.();
		expect(await fetch).toBeOk();
		expect(await stat(getProjectCachePaths(directory).lock)).toBeDefined();
		expect(await second.instance.executeCommand({ type: "content.fetch" })).toBeOk();
	});
});
