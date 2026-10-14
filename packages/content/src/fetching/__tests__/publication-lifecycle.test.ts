import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactCache } from "../../cache/artifact-cache.js";
import { content } from "../../launchpad-content.js";
import * as ManifestUtils from "../../manifest.js";
import { defineSource } from "../../source.js";
import { getProjectCachePaths } from "../../utils/paths-helper.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("publication receipts and cleanup boundaries (real filesystem)", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-publication-"));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await chmod(path.join(directory, "backups/a/locked"), 0o700).catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"does not restore a partially deleted backup after backup-cleanup failure",
		async () => {
			let value = "old";
			let blockBackupCleanup = false;
			const ctx = createMockPluginCtx(directory);
			const setup = await content({
				downloadPath: "downloads",
				tempPath: "temp",
				backupPath: "backups",
				backupAndRestore: true,
				sources: [
					defineSource({ id: "a", fetch: () => [{ id: "doc", data: Promise.resolve({ value }) }] }),
				],
				transforms: [
					{
						name: "artifact",
						apply: async ({ cache, paths }) => {
							await cache.derive({
								sourceId: "a",
								namespace: "test",
								version: "1",
								inputs: [],
								options: { value },
								outputs: ["plain.txt", "locked/kept.txt"],
								generate: async () => {
									await mkdir(path.join(paths.getDownloadPath("a"), "locked"), { recursive: true });
									await writeFile(path.join(paths.getDownloadPath("a"), "plain.txt"), value);
									await writeFile(path.join(paths.getDownloadPath("a"), "locked/kept.txt"), value);
								},
							});
							if (blockBackupCleanup)
								await chmod(path.join(paths.getBackupPath("a"), "locked"), 0o500);
						},
					},
				],
			}).setup(ctx);
			expect(setup).toBeOk();
			const instance = setup._unsafeUnwrap();
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			value = "new";
			blockBackupCleanup = true;
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
			await expect(stat(path.join(directory, "backups/a/plain.txt"))).rejects.toThrow();
			expect(await readFile(path.join(directory, "backups/a/locked/kept.txt"), "utf8")).toBe("old");
			for (const filename of ["plain.txt", "locked/kept.txt"]) {
				expect(await readFile(path.join(directory, "downloads/a", filename), "utf8")).toBe("new");
			}
			const database = new DatabaseSync(getProjectCachePaths(directory).database);
			try {
				expect(database.prepare("SELECT source_id FROM unsafe_sources").all()).toEqual([
					{ source_id: "a" },
				]);
			} finally {
				database.close();
			}
			expect(ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Restoring"));
		},
	);

	it("resolves each seed root once and commits against promoted roots rather than the active pointer", async () => {
		let generations = 0;
		let swapManifestDuringGeneration = false;
		const ctx = createMockPluginCtx(directory);
		const setup = await content({
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			backupAndRestore: false,
			keep: ["*.keep"],
			versioning: { keepVersions: 3 },
			sources: [
				defineSource({
					id: "a",
					fetch: () => [{ id: "doc", data: Promise.resolve({ stable: true }) }],
				}),
			],
			transforms: [
				{
					name: "artifact",
					apply: async ({ cache, paths }) => {
						if (swapManifestDuringGeneration) {
							expect(
								await readFile(path.join(paths.getDownloadPath("a"), "retained.keep"), "utf8"),
							).toBe("seeded");
							const active = await ManifestUtils.readManifest(path.join(directory, "downloads"));
							if (active.status !== "ok") throw new Error("Missing active manifest");
							expect(
								await ManifestUtils.writeManifest(path.join(directory, "downloads"), {
									...active.manifest,
									versionPath: "versions/missing",
								}),
							).toBeOk();
						}
						await cache.derive({
							sourceId: "a",
							namespace: "test",
							version: "1",
							inputs: [],
							options: {},
							outputs: ["result.txt"],
							generate: async () => {
								generations += 1;
								await writeFile(path.join(paths.getDownloadPath("a"), "result.txt"), "generated");
							},
						});
						await writeFile(path.join(paths.getDownloadPath("a"), "retained.keep"), "seeded");
					},
				},
			],
		}).setup(ctx);
		expect(setup).toBeOk();
		const instance = setup._unsafeUnwrap();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const resolve = vi.spyOn(ManifestUtils, "resolveManifestSourceRoots");
		swapManifestDuringGeneration = true;
		const originalCommit = ArtifactCache.prototype.commitPublication;
		vi.spyOn(ArtifactCache.prototype, "commitPublication").mockImplementation(async function (
			this: ArtifactCache,
			finalRoot,
		) {
			const active = await ManifestUtils.readManifest(path.join(directory, "downloads"));
			if (active.status !== "ok") throw new Error("Missing promoted manifest");
			expect(
				await ManifestUtils.writeManifest(path.join(directory, "downloads"), {
					...active.manifest,
					versionPath: "versions/missing",
				}),
			).toBeOk();
			return originalCommit.call(this, finalRoot);
		});
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(generations).toBe(1);
		const database = new DatabaseSync(getProjectCachePaths(directory).database);
		try {
			expect(database.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({
				count: 1,
			});
			expect(database.prepare("SELECT source_id FROM unsafe_sources").all()).toEqual([]);
		} finally {
			database.close();
		}
		expect(await readdir(path.join(directory, "temp/runs"))).toEqual([]);
	});
});
