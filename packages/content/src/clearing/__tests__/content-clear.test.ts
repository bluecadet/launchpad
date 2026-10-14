import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { content } from "../../launchpad-content.js";
import { readManifest } from "../../manifest.js";
import { defineSource } from "../../source.js";
import { getProjectCachePaths } from "../../utils/paths-helper.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("validated source clear plans (real filesystem)", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-clear-plan-"));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(directory, { recursive: true, force: true });
	});

	async function setup(sourceIds: string[], versioning = false) {
		const result = await content({
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			backupAndRestore: false,
			versioning,
			sources: sourceIds.map((id) =>
				defineSource({ id, fetch: () => [{ id: "doc", data: Promise.resolve({ stable: true }) }] }),
			),
			transforms: [
				{
					name: "plugin",
					apply: async ({ cache, paths }) => {
						for (const sourceId of sourceIds) {
							await cache.derive({
								sourceId,
								namespace: "test",
								version: "1",
								inputs: [],
								options: {},
								outputs: ["result.txt"],
								generate: async () => {
									await writeFile(
										path.join(paths.getDownloadPath(sourceId), "result.txt"),
										sourceId,
									);
								},
							});
						}
					},
				},
			],
		}).setup(createMockPluginCtx(directory));
		expect(result).toBeOk();
		return result._unsafeUnwrap();
	}

	async function sentinel(relative: string) {
		const filename = path.join(directory, relative, "sentinel");
		await mkdir(path.dirname(filename), { recursive: true });
		await writeFile(filename, relative);
		return filename;
	}

	it.each([
		"runs",
		"downloads",
		"plugin",
		"RUNS",
		"DOWNLOADS",
		"PLUGIN",
		".promotion-rollback",
		".recovery",
		".recovery-rollback",
	])("clears source %s leaves without deleting another source's namespaces", async (selected) => {
		const instance = await setup([selected, "b"]);
		const namespaces = ["temp/plugin", "temp/runs/old/downloads", "temp/runs/old/plugin"];
		const selectedFiles = await Promise.all(
			namespaces.map((root) => sentinel(`${root}/${selected}`)),
		);
		const otherFiles = await Promise.all(
			namespaces.flatMap((root) => [sentinel(`${root}/b`), sentinel(`${root}/removed-source`)]),
		);
		const unknownFile = await sentinel(`temp/runs/old/unknown-plugin/${selected}`);
		const recoveryFiles = await Promise.all(
			[".promotion-rollback", ".recovery", ".recovery-rollback"].map((name) =>
				sentinel(`temp/runs/old/${name}/b`),
			),
		);
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: [selected],
				downloads: false,
				temp: true,
			}),
		).toBeOk();
		for (const filename of selectedFiles) await expect(stat(filename)).rejects.toThrow();
		for (const filename of [...otherFiles, ...recoveryFiles, unknownFile])
			expect(await readFile(filename, "utf8")).toBeTruthy();
	});

	it("includes direct run source leaves and configured legacy transform leaves", async () => {
		const instance = await setup(["a", "b"]);
		const roots = [
			"temp",
			"temp/plugin",
			"temp/runs/old",
			"temp/runs/old/plugin",
			"temp/runs/old/downloads",
		];
		const selectedFiles = await Promise.all(roots.map((root) => sentinel(`${root}/a`)));
		const otherFiles = await Promise.all(roots.map((root) => sentinel(`${root}/b`)));
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["a"],
				downloads: false,
				temp: true,
			}),
		).toBeOk();
		for (const filename of selectedFiles) await expect(stat(filename)).rejects.toThrow();
		for (const filename of otherFiles) expect(await readFile(filename, "utf8")).toBeTruthy();
	});

	it.each(["cache", "temp", "backups"] as const)(
		"does not inspect a malformed manifest during %s-only clear",
		async (operation) => {
			const instance = await setup(["a"], true);
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			const tempFile = await sentinel("temp/plugin/a");
			const backupFile = await sentinel("backups/a");
			await writeFile(path.join(directory, "downloads/manifest.json"), "malformed manifest");
			expect(
				await instance.executeCommand({
					type: "content.clear",
					downloads: false,
					[operation]: true,
				}),
			).toBeOk();
			expect(await readFile(path.join(directory, "downloads/manifest.json"), "utf8")).toBe(
				"malformed manifest",
			);
			if (operation === "temp") await expect(stat(tempFile)).rejects.toThrow();
			if (operation === "backups") await expect(stat(backupFile)).rejects.toThrow();
		},
	);

	it("validates all requested paths before invalidating any metadata or clearing temp", async () => {
		const instance = await setup(["a"], true);
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const tempFile = await sentinel("temp/plugin/a");
		const database = new DatabaseSync(getProjectCachePaths(directory).database);
		try {
			const before = database.prepare("SELECT * FROM artifacts").all();
			expect(before.length).toBeGreaterThan(0);
			await writeFile(path.join(directory, "downloads/manifest.json"), "invalid manifest");
			expect(
				await instance.executeCommand({ type: "content.clear", sources: ["a"], temp: true }),
			).toBeErr();
			expect(database.prepare("SELECT * FROM artifacts").all()).toEqual(before);
			expect(await readFile(tempFile, "utf8")).toBeTruthy();
		} finally {
			database.close();
		}
	});

	it("rejects a selected symlink target without mutating other requested paths or metadata", async () => {
		const instance = await setup(["a"]);
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const outside = await sentinel("outside");
		await mkdir(path.join(directory, "temp/plugin"), { recursive: true });
		await symlink(path.dirname(outside), path.join(directory, "temp/plugin/a"));
		expect(
			await instance.executeCommand({ type: "content.clear", sources: ["a"], temp: true }),
		).toBeErr();
		expect(await readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe("a");
		expect(await readFile(outside, "utf8")).toBeTruthy();
	});

	it("preserves aliased published paths during cache-only clear", async () => {
		const instance = await setup(["a", "b"], true);
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const active = await readManifest(path.join(directory, "downloads"));
		if (active.status !== "ok") throw new Error("Missing manifest");
		await writeFile(
			path.join(directory, "downloads/manifest.json"),
			JSON.stringify({ ...active.manifest, sources: [{ sourceId: "a", path: "b" }] }),
		);
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["a"],
				downloads: false,
				cache: true,
			}),
		).toBeOk();
		expect(
			await readFile(
				path.join(directory, "downloads", active.manifest.versionPath, "b/result.txt"),
				"utf8",
			),
		).toBe("b");
	});

	it("refuses an ambiguous direct source/unknown historical transform root", async () => {
		const instance = await setup(["unknown-plugin", "b"]);
		const otherFile = await sentinel("temp/runs/old/unknown-plugin/b");
		const selectedFile = await sentinel("temp/plugin/unknown-plugin");
		expect(
			await instance.executeCommand({
				type: "content.clear",
				sources: ["unknown-plugin"],
				downloads: false,
				temp: true,
			}),
		).toBeErr();
		expect(await readFile(otherFile, "utf8")).toBeTruthy();
		expect(await readFile(selectedFile, "utf8")).toBeTruthy();
	});

	it.for(["A", "A/nested"])(
		"rejects physical manifest overlap at %s before mutating bytes or metadata",
		async (alias, testContext) => {
			const instance = await setup(["a", "b"], true);
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			const active = await readManifest(path.join(directory, "downloads"));
			if (active.status !== "ok") throw new Error("Missing manifest");
			const versionRoot = path.join(directory, "downloads", active.manifest.versionPath);
			const original = await stat(path.join(versionRoot, "a"));
			try {
				const upper = await stat(path.join(versionRoot, "A"));
				if (original.ino !== upper.ino || original.dev !== upper.dev) testContext.skip();
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT")
					testContext.skip();
				throw error;
			}
			const nestedFile = await sentinel(
				path.relative(directory, path.join(versionRoot, "a/nested")),
			);
			const tempFile = await sentinel("temp/plugin/a");
			const backupFile = await sentinel("backups/a");
			await writeFile(
				path.join(directory, "downloads/manifest.json"),
				JSON.stringify({
					...active.manifest,
					sources: [
						{ sourceId: "a", path: "a" },
						{ sourceId: "b", path: alias },
					],
				}),
			);
			expect((await readManifest(path.join(directory, "downloads"))).status).toBe("ok");
			const database = new DatabaseSync(getProjectCachePaths(directory).database);
			try {
				const before = database.prepare("SELECT * FROM artifacts ORDER BY source_id").all();
				expect(before).toHaveLength(2);
				expect(
					await instance.executeCommand({
						type: "content.clear",
						sources: ["a"],
						temp: true,
						backups: true,
					}),
				).toBeErr();
				expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
				for (const sourceId of ["a", "b"])
					expect(await readFile(path.join(versionRoot, sourceId, "result.txt"), "utf8")).toBe(
						sourceId,
					);
				for (const filename of [nestedFile, tempFile, backupFile])
					expect(await readFile(filename, "utf8")).toBeTruthy();
				expect(database.prepare("SELECT * FROM artifacts ORDER BY source_id").all()).toEqual(
					before,
				);
				expect(database.prepare("SELECT source_id FROM unsafe_sources").all()).toEqual([]);
				expect(
					await instance.executeCommand({
						type: "content.clear",
						sources: ["a"],
						downloads: false,
						cache: true,
					}),
				).toBeOk();
				expect(database.prepare("SELECT source_id FROM artifacts").all()).toEqual([
					{ source_id: "b" },
				]);
				for (const filename of [nestedFile, tempFile, backupFile])
					expect(await readFile(filename, "utf8")).toBeTruthy();
			} finally {
				database.close();
			}
		},
	);

	it("all-source temp clear can remove unknown historical transform namespaces", async () => {
		const instance = await setup(["a"]);
		await sentinel("temp/runs/old/unknown-plugin/a");
		expect(
			await instance.executeCommand({ type: "content.clear", downloads: false, temp: true }),
		).toBeOk();
		await expect(
			stat(path.join(directory, "temp/runs/old/unknown-plugin/a/sentinel")),
		).rejects.toThrow();
	});
});
