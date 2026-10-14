import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMockLogger, createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteStore } from "../../cache/sqlite-store.js";
import { content } from "../../launchpad-content.js";
import { defineSource } from "../../source.js";
import { getProjectCachePaths } from "../../utils/paths-helper.js";
import { markCacheUntrusted, openRunCache } from "../cache-lifecycle.js";

vi.unmock("node:fs");
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));
vi.mock("node:os", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:os")>()),
}));
vi.unmock("fs");

describe("durable cache invalidation (real files and SQLite)", () => {
	let directory: string;
	let generations: number;
	let value: string;

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "launchpad-invalidation-"));
		generations = 0;
		value = "original";
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(directory, { recursive: true, force: true });
	});

	// Keep all filesystem operations real; inject only failures at durability barriers.
	function watchSync(failure?: (filename: string, isDirectory: boolean) => Error | undefined) {
		const originalOpen = fs.open;
		const synced: string[] = [];
		vi.spyOn(fs, "open").mockImplementation(async (...arguments_) => {
			const file = await originalOpen(...arguments_);
			const filename = String(arguments_[0]);
			const originalSync = file.sync.bind(file);
			vi.spyOn(file, "sync").mockImplementation(async () => {
				const error = failure?.(filename, (await file.stat()).isDirectory());
				if (error) throw error;
				await originalSync();
				synced.push(filename);
			});
			return file;
		});
		return synced;
	}

	function unsupportedDirectorySync() {
		return watchSync((_filename, isDirectory) =>
			isDirectory
				? Object.assign(new Error("unsupported directory fsync"), { code: "EPERM" })
				: undefined,
		);
	}

	async function setup() {
		const ctx = createMockPluginCtx(directory);
		const result = await content({
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			backupAndRestore: true,
			sources: [defineSource({ id: "a", fetch: () => [] })],
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
							outputs: ["result.txt"],
							generate: async () => {
								generations += 1;
								await fs.writeFile(path.join(paths.getDownloadPath("a"), "result.txt"), value);
							},
						});
					},
				},
			],
		}).setup(ctx);
		expect(result).toBeOk();
		return { instance: result._unsafeUnwrap(), ctx };
	}

	it("flushes the Windows marker without opening a directory for sync", async () => {
		vi.spyOn(os, "platform").mockReturnValue("win32");
		const synced = unsupportedDirectorySync();
		await markCacheUntrusted(directory);
		const paths = getProjectCachePaths(directory);
		expect(synced).toEqual([paths.untrusted]);
		expect(fs.open).not.toHaveBeenCalledWith(paths.directory, "r");
		expect(await fs.readFile(paths.untrusted, "utf8")).toContain("discarded before reuse");
	});

	it.skipIf(process.platform === "win32")(
		"does not suppress a POSIX directory-sync EPERM",
		async () => {
			vi.spyOn(os, "platform").mockReturnValue("linux");
			unsupportedDirectorySync();
			await expect(markCacheUntrusted(directory)).rejects.toMatchObject({ code: "EPERM" });
		},
	);

	it("recovers a corrupt cache, regenerates once, then reuses without directory-sync support", async () => {
		vi.spyOn(os, "platform").mockReturnValue("win32");
		const synced = unsupportedDirectorySync();
		const paths = getProjectCachePaths(directory);
		await fs.mkdir(paths.directory, { recursive: true });
		await fs.writeFile(paths.database, "corrupt database");
		const { instance, ctx } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const lease = await fs.stat(paths.lock);
		expect(ctx.logger.warn).toHaveBeenCalled();
		expect(synced).toContain(paths.untrusted);
		expect(await fs.stat(paths.untrusted)).toBeDefined();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(synced).toContain(paths.database);
		await expect(fs.stat(paths.untrusted)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		expect(generations).toBe(2);
		expect((await fs.stat(paths.lock)).ino).toBe(lease.ino);
	});

	it.each([false, true])(
		"falls back safely when the publication journal outcome is uncertain (committed: %s)",
		async (committed) => {
			vi.spyOn(os, "platform").mockReturnValue("win32");
			unsupportedDirectorySync();
			const { instance, ctx } = await setup();
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			const originalBegin = SqliteStore.prototype.beginPublication;
			vi.spyOn(SqliteStore.prototype, "beginPublication").mockImplementationOnce(function (
				this: SqliteStore,
				sources,
			) {
				if (committed) originalBegin.call(this, sources);
				throw new Error("journal outcome unknown");
			});
			value = "replacement";
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			expect(ctx.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Could not journal"),
				expect.any(Error),
			);
			expect(await fs.readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(value);
			expect(await fs.stat(getProjectCachePaths(directory).untrusted)).toBeDefined();
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
			expect(generations).toBe(3);
		},
	);

	it("refuses publication when the Windows marker file itself cannot be flushed", async () => {
		vi.spyOn(os, "platform").mockReturnValue("win32");
		const { instance } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const paths = getProjectCachePaths(directory);
		const lease = await fs.stat(paths.lock);
		vi.spyOn(SqliteStore.prototype, "beginPublication").mockImplementationOnce(() => {
			throw new Error("journal failed before commit");
		});
		watchSync((filename) =>
			filename === paths.untrusted
				? Object.assign(new Error("marker flush denied"), { code: "EPERM" })
				: undefined,
		);
		value = "must not publish";
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeErr();
		expect(await fs.readFile(path.join(directory, "downloads/a/result.txt"), "utf8")).toBe(
			"original",
		);
		expect((await fs.stat(paths.lock)).ino).toBe(lease.ino);
		vi.restoreAllMocks();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
	});

	it("durably clears existing recovery files before the database and keeps their entries intact", async () => {
		vi.spyOn(os, "platform").mockReturnValue("win32");
		const paths = getProjectCachePaths(directory);
		await markCacheUntrusted(directory);
		const filenames = [
			`${paths.database}-wal`,
			`${paths.database}-shm`,
			`${paths.database}-journal`,
			paths.database,
		];
		for (const filename of filenames) await fs.writeFile(filename, "stale recovery bytes");
		const inodes = await Promise.all(
			filenames.map(async (filename) => (await fs.stat(filename)).ino),
		);
		const synced = watchSync((filename) => {
			if (filename === paths.database) {
				// Stop just after the reset's durability barriers, before opening SQLite.
				return new Error("stop before marker removal");
			}
			return undefined;
		});
		await expect(
			openRunCache(
				directory,
				createMockLogger(),
				() => undefined,
				() => directory,
			),
		).rejects.toThrow("stop before marker removal");
		expect(synced).toEqual(filenames.slice(0, -1));
		for (const [index, filename] of filenames.entries()) {
			expect((await fs.stat(filename)).ino).toBe(inodes[index]);
			expect(await fs.readFile(filename)).toHaveLength(0);
		}
		expect(await fs.stat(paths.untrusted)).toBeDefined();
		vi.restoreAllMocks();
		const cache = await openRunCache(
			directory,
			createMockLogger(),
			() => undefined,
			() => directory,
		);
		try {
			expect(cache.available).toBe(true);
			await expect(fs.stat(paths.untrusted)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await cache.close();
		}
	});

	it("does not recover old rows from a real SQLite WAL after resetting the marker", async () => {
		const { instance } = await setup();
		expect(await instance.executeCommand({ type: "content.fetch" })).toBeOk();
		const paths = getProjectCachePaths(directory);
		const database = new DatabaseSync(paths.database);
		let snapshots: { filename: string; bytes: Buffer }[];
		try {
			database.exec(`
				PRAGMA wal_autocheckpoint = 0;
				INSERT INTO artifacts
				SELECT source_id, kind, artifact_key || '-stale', record_json FROM artifacts;
			`);
			expect(database.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({
				count: 2,
			});
			snapshots = await Promise.all(
				[paths.database, `${paths.database}-wal`, `${paths.database}-shm`].map(
					async (filename) => ({
						filename,
						bytes: await fs.readFile(filename),
					}),
				),
			);
		} finally {
			database.close();
		}
		// Restore the pre-checkpoint image to model a process ending with a live WAL.
		for (const { filename, bytes } of snapshots) await fs.writeFile(filename, bytes);
		await markCacheUntrusted(directory);
		const cache = await openRunCache(
			directory,
			createMockLogger(),
			() => undefined,
			() => directory,
		);
		try {
			expect(cache.available).toBe(true);
			const recovered = new DatabaseSync(paths.database);
			try {
				expect(recovered.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({
					count: 0,
				});
			} finally {
				recovered.close();
			}
		} finally {
			await cache.close();
		}
	});

	it.each(["-wal", "-shm", "-journal", ""])(
		"keeps the marker and blocks reuse if reset cannot sync the database%s file",
		async (suffix) => {
			const paths = getProjectCachePaths(directory);
			await markCacheUntrusted(directory);
			await fs.writeFile(paths.database + suffix, "stale metadata");
			watchSync((filename) =>
				filename === paths.database + suffix
					? Object.assign(new Error("reset flush failed"), { code: "EIO" })
					: undefined,
			);
			await expect(
				openRunCache(
					directory,
					createMockLogger(),
					() => undefined,
					() => directory,
				),
			).rejects.toMatchObject({ code: "EIO" });
			expect(await fs.stat(paths.untrusted)).toBeDefined();
		},
	);
});
