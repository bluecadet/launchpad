import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as FileUtils from "../file-utils.js";

describe("FileUtils", () => {
	beforeEach(() => {
		vol.reset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("isDir", () => {
		it("should return true for existing directories", () => {
			vol.mkdirSync("/test-dir");
			expect(FileUtils.isDir("/test-dir")).toBe(true);
		});

		it("should return false for non-existing paths", () => {
			expect(FileUtils.isDir("/non-existing")).toBe(false);
		});

		it("should return false for files", () => {
			vol.writeFileSync("/test-file.txt", "content");
			expect(FileUtils.isDir("/test-file.txt")).toBe(false);
		});
	});

	describe("saveJson", () => {
		it("should save JSON to a file", async () => {
			const result = await FileUtils.saveJson({ test: "data" }, "/test.json");
			expect(result).toBeOk();
			expect(vol.readFileSync("/test.json", "utf8")).toBe('{"test":"data"}');
		});

		it("should append .json extension if not provided", async () => {
			const result = await FileUtils.saveJson({ test: "data" }, "/test");
			expect(result).toBeOk();
			expect(vol.readFileSync("/test.json", "utf8")).toBe('{"test":"data"}');
		});

		it("should create directories if they don't exist", async () => {
			const result = await FileUtils.saveJson({ test: "data" }, "/nested/dir/test.json");
			expect(result).toBeOk();
			expect(vol.readFileSync("/nested/dir/test.json", "utf8")).toBe('{"test":"data"}');
		});
	});

	describe("removeFilesFromDir", () => {
		beforeEach(() => {
			vol.fromNestedJSON({
				"/test-dir": {
					"file1.txt": "content",
					"file2.json": "{}",
					subdir: {
						"file3.csv": "data",
					},
				},
			});
		});

		it("should remove all files and subdirectories", async () => {
			const result = await FileUtils.removeFilesFromDir("/test-dir");
			expect(result).toBeOk();
			expect(vol.readdirSync("/test-dir")).toHaveLength(0);
		});

		it("should exclude specified files", async () => {
			const result = await FileUtils.removeFilesFromDir("/test-dir", ["*.json", "**/*.csv"]);
			expect(result).toBeOk();
			expect(vol.readdirSync("/test-dir", { recursive: true })).toEqual(
				expect.arrayContaining(["file2.json", "subdir/file3.csv", "subdir"]),
			);
		});
	});

	describe("ensureDir", () => {
		it("should create a directory if it doesn't exist", async () => {
			const result = await FileUtils.ensureDir("/new-dir");
			expect(result).toBeOk();
			expect(vol.existsSync("/new-dir")).toBe(true);
		});

		it("should create nested directories", async () => {
			const result = await FileUtils.ensureDir("/nested/dir/structure");
			expect(result).toBeOk();
			expect(vol.existsSync("/nested/dir/structure")).toBe(true);
		});

		it("should not fail if the directory already exists", async () => {
			vol.mkdirSync("/existing-dir");
			const result = await FileUtils.ensureDir("/existing-dir");
			expect(result).toBeOk();
		});
	});

	describe("getDateString", () => {
		it("should return a formatted date string", () => {
			const testDate = new Date(2023, 3, 15, 10, 30, 45);
			const result = FileUtils.getDateString(testDate);
			expect(result).toBe("2023-04-16_10-30-45");
		});

		it("should use current date if no date is provided", () => {
			const result = FileUtils.getDateString();
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
		});
	});

	describe("pad", () => {
		it("should pad numbers with leading zeros", () => {
			expect(FileUtils.pad(5, 2)).toBe("05");
			expect(FileUtils.pad(10, 3)).toBe("010");
			expect(FileUtils.pad(100, 3)).toBe("100");
		});
	});

	describe("removeDirIfEmpty", () => {
		it("should remove an empty directory", async () => {
			vol.mkdirSync("/empty-dir");
			const result = await FileUtils.removeDirIfEmpty("/empty-dir");
			expect(result).toBeOk();
			expect(vol.existsSync("/empty-dir")).toBe(false);
		});

		it("should not remove a non-empty directory", async () => {
			vol.mkdirSync("/non-empty-dir");
			vol.writeFileSync("/non-empty-dir/file.txt", "content");
			const result = await FileUtils.removeDirIfEmpty("/non-empty-dir");
			expect(result).toBeOk();
			expect(vol.existsSync("/non-empty-dir")).toBe(true);
		});
	});

	describe("isDirEmpty", () => {
		it("should return true for an empty directory", async () => {
			vol.mkdirSync("/empty-dir");
			const result = await FileUtils.isDirEmpty("/empty-dir");
			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(true);
		});

		it("should return false for a non-empty directory", async () => {
			vol.mkdirSync("/non-empty-dir");
			vol.writeFileSync("/non-empty-dir/file.txt", "content");
			const result = await FileUtils.isDirEmpty("/non-empty-dir");
			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(false);
		});
	});

	describe("remove", () => {
		it("should remove a file", async () => {
			vol.writeFileSync("/test-file.txt", "content");
			const result = await FileUtils.remove("/test-file.txt");
			expect(result).toBeOk();
			expect(vol.existsSync("/test-file.txt")).toBe(false);
		});

		it("should remove a directory and its contents", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/file.txt", "content");
			const result = await FileUtils.remove("/test-dir");
			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir")).toBe(false);
		});

		it("should not fail if the path does not exist", async () => {
			const result = await FileUtils.remove("/non-existing");
			expect(result).toBeOk();
		});
	});

	describe("pathExists", () => {
		it("should return true for existing files", async () => {
			vol.writeFileSync("/test-file.txt", "content");
			const result = await FileUtils.pathExists("/test-file.txt");
			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(true);
		});

		it("should return true for existing directories", async () => {
			vol.mkdirSync("/test-dir");
			const result = await FileUtils.pathExists("/test-dir");
			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(true);
		});

		it("should return false for non-existing paths", async () => {
			const result = await FileUtils.pathExists("/non-existing");
			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(false);
		});
	});

	describe("copy", () => {
		it("should copy a file", async () => {
			vol.writeFileSync("/source-file.txt", "content");
			const result = await FileUtils.copy("/source-file.txt", "/dest-file.txt");
			expect(result).toBeOk();
			expect(vol.readFileSync("/dest-file.txt", "utf8")).toBe("content");
		});

		it("should copy a directory and its contents", async () => {
			vol.mkdirSync("/source-dir");
			vol.writeFileSync("/source-dir/file1.txt", "content1");
			vol.writeFileSync("/source-dir/file2.txt", "content2");
			const result = await FileUtils.copy("/source-dir", "/dest-dir");
			expect(result).toBeOk();
			expect(vol.existsSync("/dest-dir")).toBe(true);
			expect(vol.readFileSync("/dest-dir/file1.txt", "utf8")).toBe("content1");
			expect(vol.readFileSync("/dest-dir/file2.txt", "utf8")).toBe("content2");
		});

		it("should preserve timestamps when copying", async () => {
			vol.writeFileSync("/source-file.txt", "content");
			const date = new Date();
			vi.setSystemTime(date.getTime());
			const sourceStats = vol.statSync("/source-file.txt");
			vi.setSystemTime(date.getTime() + 1000);
			const result = await FileUtils.copy("/source-file.txt", "/dest-file.txt", {
				preserveTimestamps: true,
			});
			expect(result).toBeOk();
			const destStats = vol.statSync("/dest-file.txt");
			expect(destStats.mtime).toEqual(sourceStats.mtime);
			expect(destStats.atime).toEqual(sourceStats.atime);
		});
	});
});
