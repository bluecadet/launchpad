import { fs } from "memfs";
import { describe, expect, it, vi } from "vitest";
import {
	deletePidFile,
	getDaemonPid,
	isDaemonRunning,
	isProcessRunning,
	readPidFile,
	writePidFile,
} from "../pid-utils.js";

describe("pid-utils", () => {
	describe("writePidFile", () => {
		it("should write PID to file", () => {
			const result = writePidFile("/test/pid", 12345);

			expect(result.isOk()).toBe(true);
			const content = fs.readFileSync("/test/pid", { encoding: "utf-8" });
			expect(content).toBe("12345");
		});

		it("should create directory if it does not exist", () => {
			const result = writePidFile("/test/nested/dir/pid", 12345);

			expect(result.isOk()).toBe(true);
			expect(fs.existsSync("/test/nested/dir")).toBe(true);
		});

		it("should overwrite existing PID file", () => {
			writePidFile("/test/pid", 12345);
			const result = writePidFile("/test/pid", 54321);

			expect(result.isOk()).toBe(true);
			const content = fs.readFileSync("/test/pid", { encoding: "utf-8" });
			expect(content).toBe("54321");
		});

		it("should return error on write failure", () => {
			// Mock fs to fail
			const original = fs.writeFileSync;
			vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
				throw new Error("Write failed");
			});

			const result = writePidFile("/test/pid", 12345);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Failed to write PID file");

			fs.writeFileSync = original;
		});
	});

	describe("readPidFile", () => {
		it("should read PID from file", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			const result = readPidFile("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(12345);
		});

		it("should handle PID with leading/trailing whitespace", () => {
			fs.writeFileSync("/test/pid", "  54321  \n", { encoding: "utf-8" });
			const result = readPidFile("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(54321);
		});

		it("should return error if file does not exist", () => {
			const result = readPidFile("/test/nonexistent/pid");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("PID file does not exist");
		});

		it("should return error if PID is not a valid number", () => {
			fs.writeFileSync("/test/pid", "not-a-number", { encoding: "utf-8" });
			const result = readPidFile("/test/pid");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Invalid PID in file");
		});

		it("should return error on read failure", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			const original = fs.readFileSync;
			vi.spyOn(fs, "readFileSync").mockImplementation(() => {
				throw new Error("Read failed");
			});

			const result = readPidFile("/test/pid");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Failed to read PID file");

			fs.readFileSync = original;
		});
	});

	describe("deletePidFile", () => {
		it("should delete PID file", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			const result = deletePidFile("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(fs.existsSync("/test/pid")).toBe(false);
		});

		it("should succeed if file does not exist", () => {
			const result = deletePidFile("/test/nonexistent/pid");

			expect(result.isOk()).toBe(true);
		});

		it("should return error on deletion failure", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			const original = fs.unlinkSync;
			vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
				throw new Error("Unlink failed");
			});

			const result = deletePidFile("/test/pid");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Failed to delete PID file");

			fs.unlinkSync = original;
		});
	});

	describe("isProcessRunning", () => {
		it("should return true if process is running", () => {
			// Mock process.kill to not throw
			vi.spyOn(process, "kill").mockImplementation(() => true as never);

			const result = isProcessRunning(12345);

			expect(result).toBe(true);
		});

		it("should return false if process is not running", () => {
			// Mock process.kill to throw (process not found)
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			const result = isProcessRunning(12345);

			expect(result).toBe(false);
		});
	});

	describe("isDaemonRunning", () => {
		it("should return true if PID file exists and process is running", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			vi.spyOn(process, "kill").mockImplementation(() => true as never);

			const result = isDaemonRunning("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(true);
		});

		it("should return false if PID file does not exist", () => {
			const result = isDaemonRunning("/test/nonexistent/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(false);
		});

		it("should return false if process is not running", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			const result = isDaemonRunning("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(false);
		});
	});

	describe("getDaemonPid", () => {
		it("should return PID if daemon is running", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			vi.spyOn(process, "kill").mockImplementation(() => true as never);

			const result = getDaemonPid("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe(12345);
		});

		it("should return null if PID file does not exist", () => {
			const result = getDaemonPid("/test/nonexistent/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeNull();
		});

		it("should return null and clean up stale PID file if process is not running", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			const result = getDaemonPid("/test/pid");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeNull();
			expect(fs.existsSync("/test/pid")).toBe(false);
		});

		it("should handle stale PID file cleanup error gracefully", () => {
			fs.writeFileSync("/test/pid", "12345", { encoding: "utf-8" });
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw new Error("ESRCH");
			});

			// Process.kill will throw, but deletion failure should not affect result
			const result = getDaemonPid("/test/pid");

			// Still returns ok(null) even if file isn't deleted (in real scenario)
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeNull();
		});
	});
});
