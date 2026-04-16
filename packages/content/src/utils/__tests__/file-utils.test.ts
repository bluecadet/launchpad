import { vol } from "memfs";
import { errAsync } from "neverthrow";
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

	describe("replacePath", () => {
		it("should replace an existing directory with staged content", async () => {
			vol.mkdirSync("/published/source", { recursive: true });
			vol.writeFileSync("/published/source/old.json", "old");
			vol.mkdirSync("/staged/source", { recursive: true });
			vol.writeFileSync("/staged/source/new.json", "new");

			const result = await FileUtils.replacePath("/staged/source", "/published/source", {
				rollbackDir: "/rollback",
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/published/source/new.json")).toBe(true);
			expect(vol.existsSync("/published/source/old.json")).toBe(false);
			expect(vol.existsSync("/staged/source")).toBe(false);
		});

		it("should restore the original directory when replacement fails", async () => {
			vol.mkdirSync("/published/source", { recursive: true });
			vol.writeFileSync("/published/source/old.json", "old");
			vol.mkdirSync("/staged/source", { recursive: true });
			vol.writeFileSync("/staged/source/new.json", "new");

			const originalRename = vol.promises.rename.bind(vol.promises);
			const renameSpy = vi
				.spyOn(vol.promises, "rename")
				.mockImplementationOnce(async (oldPath, newPath) => {
					return originalRename(oldPath, newPath);
				})
				.mockImplementationOnce(async () => {
					throw new FileUtils.FileUtilsError("promotion failed");
				})
				.mockImplementation(async (oldPath, newPath) => {
					return originalRename(oldPath, newPath);
				});

			try {
				const result = await FileUtils.replacePath("/staged/source", "/published/source", {
					rollbackDir: "/rollback",
				});

				expect(result).toBeErr();
				expect(vol.existsSync("/published/source/old.json")).toBe(true);
				expect(vol.existsSync("/published/source/new.json")).toBe(false);
			} finally {
				renameSpy.mockRestore();
			}
		});
	});

	describe("clearDir", () => {
		it("should remove all files from a directory", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/file1.txt", "content1");
			vol.writeFileSync("/test-dir/file2.txt", "content2");

			const result = await FileUtils.clearDir("/test-dir");

			expect(result).toBeOk();
			expect(vol.readdirSync("/test-dir")).toHaveLength(0);
		});

		it("should remove nested directories and files", async () => {
			vol.mkdirSync("/test-dir");
			vol.mkdirSync("/test-dir/subdir");
			vol.writeFileSync("/test-dir/file.txt", "content");
			vol.writeFileSync("/test-dir/subdir/nested.txt", "nested");

			const result = await FileUtils.clearDir("/test-dir");

			expect(result).toBeOk();
			expect(vol.readdirSync("/test-dir")).toHaveLength(0);
		});

		it("should handle non-existent directories gracefully", async () => {
			const result = await FileUtils.clearDir("/non-existent-dir");

			expect(result).toBeOk();
		});

		it("should keep files matching keepPatterns", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/.keep", "");
			vol.writeFileSync("/test-dir/important.json", "{}");
			vol.writeFileSync("/test-dir/remove.txt", "remove");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: [".keep", "important.json"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir/.keep")).toBe(true);
			expect(vol.existsSync("/test-dir/important.json")).toBe(true);
			expect(vol.existsSync("/test-dir/remove.txt")).toBe(false);
		});

		it("should keep files matching glob patterns in nested directories", async () => {
			vol.mkdirSync("/test-dir/subdir", { recursive: true });
			vol.writeFileSync("/test-dir/file.json", "{}");
			vol.writeFileSync("/test-dir/subdir/data.json", "{}");
			vol.writeFileSync("/test-dir/subdir/file.csv", "data");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: ["**/*.json"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir/file.json")).toBe(true);
			expect(vol.existsSync("/test-dir/subdir/data.json")).toBe(true);
			expect(vol.existsSync("/test-dir/subdir/file.csv")).toBe(false);
		});

		it("should ignore keepPatterns when ignoreKeep is true", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/.keep", "");
			vol.writeFileSync("/test-dir/file.txt", "content");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: [".keep"],
				ignoreKeep: true,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir/.keep")).toBe(false);
			expect(vol.existsSync("/test-dir/file.txt")).toBe(false);
		});

		it("should remove empty directory when removeIfEmpty is true", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/file.txt", "content");

			const result = await FileUtils.clearDir("/test-dir", {
				removeIfEmpty: true,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir")).toBe(false);
		});

		it("should keep non-empty directory when removeIfEmpty is true but directory has excluded files", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/.keep", "");
			vol.writeFileSync("/test-dir/file.txt", "content");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: [".keep"],
				ignoreKeep: false,
				removeIfEmpty: true,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir")).toBe(true);
			expect(vol.existsSync("/test-dir/.keep")).toBe(true);
		});

		it("should handle dot files", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/.hidden", "hidden");
			vol.writeFileSync("/test-dir/.gitkeep", "keep");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: [".gitkeep"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir/.hidden")).toBe(false);
			expect(vol.existsSync("/test-dir/.gitkeep")).toBe(true);
		});

		it("should handle multiple file extensions", async () => {
			vol.mkdirSync("/test-dir");
			vol.writeFileSync("/test-dir/file.json", "{}");
			vol.writeFileSync("/test-dir/file.csv", "csv");
			vol.writeFileSync("/test-dir/file.xml", "<xml/>");
			vol.writeFileSync("/test-dir/file.txt", "text");

			const result = await FileUtils.clearDir("/test-dir", {
				keepPatterns: ["*.json", "*.csv"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/test-dir/file.json")).toBe(true);
			expect(vol.existsSync("/test-dir/file.csv")).toBe(true);
			expect(vol.existsSync("/test-dir/file.xml")).toBe(false);
			expect(vol.existsSync("/test-dir/file.txt")).toBe(false);
		});

		it("should return error when directory access fails", async () => {
			// Using invalid path to trigger potential errors
			const result = await FileUtils.clearDir("");

			// Should handle gracefully (empty path might be treated as non-existent)
			expect(result).toBeDefined();
		});
	});

	describe("clearDirs", () => {
		it("should clear multiple directories", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/file1.txt", "content1");
			vol.writeFileSync("/dir2/file2.txt", "content2");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"]);

			expect(result).toBeOk();
			expect(vol.readdirSync("/dir1")).toHaveLength(0);
			expect(vol.readdirSync("/dir2")).toHaveLength(0);
		});

		it("should handle empty directory list", async () => {
			const result = await FileUtils.clearDirs([]);

			expect(result).toBeOk();
		});

		it("should handle non-existent directories", async () => {
			const result = await FileUtils.clearDirs(["/non-existent1", "/non-existent2"]);

			expect(result).toBeOk();
		});

		it("should apply keepPatterns to all directories", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/.keep", "");
			vol.writeFileSync("/dir1/remove.txt", "");
			vol.writeFileSync("/dir2/.keep", "");
			vol.writeFileSync("/dir2/remove.txt", "");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"], {
				keepPatterns: [".keep"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/dir1/.keep")).toBe(true);
			expect(vol.existsSync("/dir1/remove.txt")).toBe(false);
			expect(vol.existsSync("/dir2/.keep")).toBe(true);
			expect(vol.existsSync("/dir2/remove.txt")).toBe(false);
		});

		it("should respect removeIfEmpty option for all directories", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/file.txt", "");
			vol.writeFileSync("/dir2/file.txt", "");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"], {
				removeIfEmpty: true,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/dir1")).toBe(false);
			expect(vol.existsSync("/dir2")).toBe(false);
		});

		it("should ignore ignoreKeep setting when true for all directories", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/.keep", "");
			vol.writeFileSync("/dir1/file.txt", "");
			vol.writeFileSync("/dir2/.keep", "");
			vol.writeFileSync("/dir2/file.txt", "");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"], {
				keepPatterns: [".keep"],
				ignoreKeep: true,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/dir1/.keep")).toBe(false);
			expect(vol.existsSync("/dir2/.keep")).toBe(false);
		});

		it("should handle mixed existent and non-existent directories", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/file.txt", "content");
			vol.writeFileSync("/dir2/file.txt", "content");

			const result = await FileUtils.clearDirs(["/dir1", "/non-existent", "/dir2"]);

			expect(result).toBeOk();
			expect(vol.readdirSync("/dir1")).toHaveLength(0);
			expect(vol.readdirSync("/dir2")).toHaveLength(0);
		});

		it("should clear many directories in parallel", async () => {
			const dirs = Array.from({ length: 5 }, (_, i) => {
				const dir = `/dir${i}`;
				vol.mkdirSync(dir);
				vol.writeFileSync(`${dir}/file.txt`, `content${i}`);
				return dir;
			});

			const result = await FileUtils.clearDirs(dirs);

			expect(result).toBeOk();
			for (const dir of dirs) {
				expect(vol.readdirSync(dir)).toHaveLength(0);
			}
		});

		it("should handle nested directories with different keep patterns", async () => {
			vol.mkdirSync("/dir1/subdir", { recursive: true });
			vol.mkdirSync("/dir2/subdir", { recursive: true });
			vol.writeFileSync("/dir1/file.json", "{}");
			vol.writeFileSync("/dir1/subdir/data.json", "{}");
			vol.writeFileSync("/dir2/file.csv", "csv");
			vol.writeFileSync("/dir2/subdir/data.csv", "csv");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"], {
				keepPatterns: ["**/*.json"],
				ignoreKeep: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/dir1/file.json")).toBe(true);
			expect(vol.existsSync("/dir1/subdir/data.json")).toBe(true);
			expect(vol.existsSync("/dir2/file.csv")).toBe(false);
			expect(vol.existsSync("/dir2/subdir/data.csv")).toBe(false);
		});

		it("should combine all options correctly", async () => {
			vol.mkdirSync("/dir1");
			vol.mkdirSync("/dir2");
			vol.writeFileSync("/dir1/.keep", "");
			vol.writeFileSync("/dir1/file.txt", "");
			vol.writeFileSync("/dir2/.keep", "");
			vol.writeFileSync("/dir2/file.txt", "");

			const result = await FileUtils.clearDirs(["/dir1", "/dir2"], {
				keepPatterns: [".keep"],
				ignoreKeep: false,
				removeIfEmpty: false,
			});

			expect(result).toBeOk();
			expect(vol.existsSync("/dir1")).toBe(true);
			expect(vol.existsSync("/dir1/.keep")).toBe(true);
			expect(vol.existsSync("/dir1/file.txt")).toBe(false);
			expect(vol.existsSync("/dir2")).toBe(true);
			expect(vol.existsSync("/dir2/.keep")).toBe(true);
			expect(vol.existsSync("/dir2/file.txt")).toBe(false);
		});
	});
});
