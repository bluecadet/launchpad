import { describe, expect, it } from "vitest";
import type { ResolvedContentConfig } from "../../content-config.js";
import { createPathsHelper, type PathsHelper } from "../paths-helper.js";
import "@bluecadet/launchpad-testing/vitest.d.ts";

describe("PathsHelper", () => {
	const mockConfig = {
		downloadPath: ".downloads",
		tempPath: ".tmp",
		backupPath: ".backup",
		keep: [],
		backupAndRestore: true,
		maxTimeout: 30000,
		encodeChars: '<>:"|?*',
		sources: [],
		transforms: [],
	} satisfies ResolvedContentConfig;

	const cwd = "/home/user/project";

	let pathsHelper: PathsHelper;

	it("should create a PathsHelper instance", () => {
		pathsHelper = createPathsHelper(mockConfig, cwd);
		expect(pathsHelper).toBeDefined();
		expect(pathsHelper.getDownloadPath).toBeDefined();
		expect(pathsHelper.getTempPath).toBeDefined();
		expect(pathsHelper.getBackupPath).toBeDefined();
	});

	describe("getDownloadPath", () => {
		it("should return the base download path when no sourceId is provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getDownloadPath();
			expect(path).toMatchPath("/home/user/project/.downloads");
		});

		it("should return the download path with sourceId appended", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getDownloadPath("source-1");
			expect(path).toMatchPath("/home/user/project/.downloads/source-1");
		});

		it("should resolve relative download paths correctly", () => {
			const config: ResolvedContentConfig = {
				...mockConfig,
				downloadPath: "downloads/content",
			};
			pathsHelper = createPathsHelper(config, cwd);
			const path = pathsHelper.getDownloadPath();
			expect(path).toMatchPath("/home/user/project/downloads/content");
		});

		it("should work with different working directories", () => {
			const altCwd = "/var/app";
			pathsHelper = createPathsHelper(mockConfig, altCwd);
			const path = pathsHelper.getDownloadPath();
			expect(path).toMatchPath("/var/app/.downloads");
		});

		it("should work with both sourceId and different cwd", () => {
			const altCwd = "/var/app";
			pathsHelper = createPathsHelper(mockConfig, altCwd);
			const path = pathsHelper.getDownloadPath("my-source");
			expect(path).toMatchPath("/var/app/.downloads/my-source");
		});
	});

	describe("getTempPath", () => {
		it("should return the base temp path when no sourceId or pluginName is provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getTempPath();
			expect(path).toMatchPath("/home/user/project/.tmp");
		});

		it("should scope temp paths to the run directory when runId is provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd, { runId: "run-123" });
			const path = pathsHelper.getTempPath();
			expect(path).toMatchPath("/home/user/project/.tmp/runs/run-123");
		});

		it("should include pluginName in the path when sourceId is also provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getTempPath("source-1", "my-plugin");
			expect(path).toMatchPath("/home/user/project/.tmp/my-plugin/source-1");
		});

		it("should include sourceId in the path when provided alone", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getTempPath("source-1");
			expect(path).toMatchPath("/home/user/project/.tmp/source-1");
		});

		it("should include both pluginName and sourceId in the path", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getTempPath("source-1", "my-plugin");
			expect(path).toMatchPath("/home/user/project/.tmp/my-plugin/source-1");
		});

		it("should resolve relative temp paths correctly", () => {
			const config: ResolvedContentConfig = {
				...mockConfig,
				tempPath: "temp/workspace",
			};
			pathsHelper = createPathsHelper(config, cwd);
			const path = pathsHelper.getTempPath();
			expect(path).toMatchPath("/home/user/project/temp/workspace");
		});

		it("should work with different working directories", () => {
			const altCwd = "/var/app";
			pathsHelper = createPathsHelper(mockConfig, altCwd);
			const path = pathsHelper.getTempPath("source-1");
			expect(path).toMatchPath("/var/app/.tmp/source-1");
		});
	});

	describe("getRunPath", () => {
		it("should return the temp root when no runId is provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			expect(pathsHelper.getRunPath()).toMatchPath("/home/user/project/.tmp");
		});

		it("should resolve run-specific paths under tempPath/runs/<runId>", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd, { runId: "run-123" });
			expect(pathsHelper.getRunPath()).toMatchPath("/home/user/project/.tmp/runs/run-123");
			expect(pathsHelper.getRunPath("downloads", "root.json")).toMatchPath(
				"/home/user/project/.tmp/runs/run-123/downloads/root.json",
			);
		});
	});

	describe("getBackupPath", () => {
		it("should return the base backup path when no sourceId is provided", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getBackupPath();
			expect(path).toMatchPath("/home/user/project/.backup");
		});

		it("should return the backup path with sourceId appended", () => {
			pathsHelper = createPathsHelper(mockConfig, cwd);
			const path = pathsHelper.getBackupPath("source-1");
			expect(path).toMatchPath("/home/user/project/.backup/source-1");
		});

		it("should resolve relative backup paths correctly", () => {
			const config: ResolvedContentConfig = {
				...mockConfig,
				backupPath: "backups/archive",
			};
			pathsHelper = createPathsHelper(config, cwd);
			const path = pathsHelper.getBackupPath();
			expect(path).toMatchPath("/home/user/project/backups/archive");
		});

		it("should work with different working directories", () => {
			const altCwd = "/data/app";
			pathsHelper = createPathsHelper(mockConfig, altCwd);
			const path = pathsHelper.getBackupPath();
			expect(path).toMatchPath("/data/app/.backup");
		});

		it("should work with both sourceId and different cwd", () => {
			const altCwd = "/data/app";
			pathsHelper = createPathsHelper(mockConfig, altCwd);
			const path = pathsHelper.getBackupPath("backup-1");
			expect(path).toMatchPath("/data/app/.backup/backup-1");
		});
	});
});
