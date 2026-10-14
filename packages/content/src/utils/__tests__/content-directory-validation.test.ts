import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedContentConfig } from "../../content-config.js";
import { getProjectCachePaths, validateContentDirectories } from "../paths-helper.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

const config = {
	downloadPath: ".downloads",
	tempPath: ".launchpad/tmp",
	backupPath: ".launchpad/backup",
	keep: [],
	backupAndRestore: true,
	maxTimeout: 30000,
	encodeChars: '<>:"|?*',
	sources: [],
	transforms: [],
	versioning: false,
} satisfies ResolvedContentConfig;

const directoryOptions = ["downloadPath", "tempPath", "backupPath"] as const;
const protectedPaths = [
	".",
	".launchpad",
	".launchpad/cache",
	".launchpad/cache/source",
	".launchpad/content-writer.lock",
	".launchpad/content-writer.lock/child",
];
const caseAliases = [
	".LAUNCHPAD",
	".LAUNCHPAD/CACHE",
	".launchpad/CACHE/source",
	".LAUNCHPAD/CONTENT-WRITER.LOCK",
];

describe("content directory validation (real filesystem)", () => {
	let directory: string;
	let caseSensitive: boolean;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-directory-validation-"));
		const probe = path.join(directory, "case-probe");
		await writeFile(probe, "probe");
		try {
			const lower = await stat(probe);
			const upper = await stat(path.join(directory, "CASE-PROBE"));
			caseSensitive = lower.ino !== upper.ino || lower.dev !== upper.dev;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			caseSensitive = true;
		} finally {
			await rm(probe);
		}
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it.each(directoryOptions)(
		"rejects protected ancestors and descendants in %s before metadata exists",
		async (option) => {
			for (const configuredPath of protectedPaths) {
				await expect(
					validateContentDirectories({ ...config, [option]: configuredPath }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
			await expect(lstat(path.join(directory, ".launchpad"))).rejects.toMatchObject({
				code: "ENOENT",
			});
		},
	);

	for (const option of directoryOptions) {
		it(`rejects nonexistent case aliases in ${option} on case-insensitive filesystems`, async ({
			skip,
		}) => {
			if (caseSensitive) skip();
			for (const configuredPath of caseAliases) {
				await expect(
					validateContentDirectories({ ...config, [option]: configuredPath }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
			await expect(lstat(path.join(directory, ".launchpad"))).rejects.toMatchObject({
				code: "ENOENT",
			});
		});

		it(`preserves distinct case names in ${option} on case-sensitive filesystems`, async ({
			skip,
		}) => {
			if (!caseSensitive) skip();
			for (const configuredPath of caseAliases) {
				await expect(
					validateContentDirectories({ ...config, [option]: configuredPath }, directory),
				).resolves.toBeUndefined();
			}
			await mkdir(path.join(directory, ".LAUNCHPAD", "CACHE"), { recursive: true });
			await mkdir(path.join(directory, ".launchpad", "cache"), { recursive: true });
			await expect(
				validateContentDirectories({ ...config, [option]: ".LAUNCHPAD/CACHE" }, directory),
			).resolves.toBeUndefined();
		});
	}

	it("rejects the uppercase temp alias after metadata exists without modifying protected files", async ({
		skip,
	}) => {
		if (caseSensitive) skip();
		const cache = getProjectCachePaths(directory);
		await mkdir(cache.directory, { recursive: true });
		await writeFile(cache.database, "database");
		await writeFile(cache.lock, "lease");
		await expect(
			validateContentDirectories({ ...config, tempPath: ".LAUNCHPAD" }, directory),
		).rejects.toThrow("overlaps protected project metadata");
		await expect(readFile(cache.database, "utf8")).resolves.toBe("database");
		await expect(readFile(cache.lock, "utf8")).resolves.toBe("lease");
	});

	it("allows safe nonexistent siblings without creating configured or protected directories", async () => {
		await expect(validateContentDirectories(config, directory)).resolves.toBeUndefined();
		await expect(
			validateContentDirectories(
				{
					...config,
					downloadPath: ".launchpad/cache-other",
					tempPath: ".launchpad/content-writer.lock-other",
				},
				directory,
			),
		).resolves.toBeUndefined();
		await expect(lstat(path.join(directory, ".launchpad"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(lstat(path.join(directory, ".downloads"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(readdir(directory)).resolves.toEqual([]);
	});

	it.each(directoryOptions)(
		"rejects existing directory symlinks into protected cache trees in %s",
		async (option) => {
			const cache = getProjectCachePaths(directory);
			await mkdir(cache.directory, { recursive: true });
			await symlink(cache.directory, path.join(directory, "alias"), "junction");
			for (const configuredPath of ["alias", "alias/missing/child"]) {
				await expect(
					validateContentDirectories({ ...config, [option]: configuredPath }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
		},
	);

	it.each(directoryOptions)(
		"rejects dangling symlinks and missing suffixes targeting future metadata in %s",
		async (option) => {
			const cache = getProjectCachePaths(directory);
			await symlink(cache.directory, path.join(directory, "alias"), "junction");
			for (const configuredPath of ["alias", "alias/missing/child"]) {
				await expect(
					validateContentDirectories({ ...config, [option]: configuredPath }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
		},
	);

	it("rejects a dangling relative symlink chain targeting future metadata", async ({ skip }) => {
		try {
			await symlink(".launchpad/cache", path.join(directory, "inner"), "dir");
			await symlink("inner", path.join(directory, "outer"), "dir");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EPERM") skip();
			throw error;
		}
		await expect(
			validateContentDirectories({ ...config, tempPath: "outer/future" }, directory),
		).rejects.toThrow("overlaps protected project metadata");
	});

	it("rejects a dangling case-alias symlink on case-insensitive filesystems", async ({ skip }) => {
		if (caseSensitive) skip();
		await symlink(path.join(directory, ".LAUNCHPAD"), path.join(directory, "alias"), "junction");
		await expect(
			validateContentDirectories({ ...config, tempPath: "alias" }, directory),
		).rejects.toThrow("overlaps protected project metadata");
	});

	it.each([false, true])(
		"protects relocated metadata through a symlink whose target exists: %s",
		async (existing) => {
			const relocated = path.join(directory, "relocated");
			if (existing) await mkdir(relocated);
			await symlink(relocated, path.join(directory, ".launchpad"), "junction");
			for (const option of directoryOptions) {
				await expect(
					validateContentDirectories({ ...config, [option]: "relocated" }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
		},
	);

	it.each([false, true])(
		"protects a cache directory relocated through a symlink whose target exists: %s",
		async (existing) => {
			const cache = getProjectCachePaths(directory);
			const relocated = path.join(directory, "relocated-cache");
			await mkdir(path.dirname(cache.directory));
			if (existing) await mkdir(relocated);
			await symlink(relocated, cache.directory, "junction");
			for (const option of directoryOptions) {
				await expect(
					validateContentDirectories({ ...config, [option]: "relocated-cache/child" }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
		},
	);

	for (const existing of [false, true]) {
		it(`rejects a symlink to the writer lock whose target exists: ${existing}`, async ({
			skip,
		}) => {
			const cache = getProjectCachePaths(directory);
			if (existing) {
				await mkdir(path.dirname(cache.lock));
				await writeFile(cache.lock, "lease");
			}
			try {
				await symlink(cache.lock, path.join(directory, "lock-alias"), "file");
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "EPERM") skip();
				throw error;
			}
			for (const option of directoryOptions) {
				await expect(
					validateContentDirectories({ ...config, [option]: "lock-alias" }, directory),
				).rejects.toThrow("overlaps protected project metadata");
			}
		});
	}

	it("rejects cyclic directory aliases rather than treating them as nonexistent suffixes", async () => {
		await symlink(path.join(directory, "inner"), path.join(directory, "outer"), "junction");
		await symlink(path.join(directory, "outer"), path.join(directory, "inner"), "junction");
		await expect(
			validateContentDirectories({ ...config, tempPath: "outer/child" }, directory),
		).rejects.toThrow();
	});

	it("rejects a configured symlink to the project ancestor", async () => {
		await symlink(directory, path.join(directory, "alias"), "junction");
		await expect(
			validateContentDirectories({ ...config, downloadPath: "alias" }, directory),
		).rejects.toThrow("overlaps protected project metadata");
	});

	it("allows existing and dangling symlinks to unrelated directories", async () => {
		const unrelated = path.join(directory, "unrelated");
		await symlink(unrelated, path.join(directory, "alias"), "junction");
		for (const existing of [false, true]) {
			if (existing) await mkdir(unrelated);
			await expect(
				validateContentDirectories({ ...config, downloadPath: "alias/missing" }, directory),
			).resolves.toBeUndefined();
		}
	});
});
