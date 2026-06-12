import { describe, expect, it } from "vitest";
import { getOSSocketPath, isWindowsNamedPipe } from "../ipc-utils.js";

describe("getOSSocketPath", () => {
	describe.runIf(process.platform !== "win32")("on posix", () => {
		it("returns the same path", () => {
			const inputPath = "/tmp/socket.sock";
			const result = getOSSocketPath(inputPath);
			expect(result).toBe(inputPath);
		});
	});

	describe.runIf(process.platform === "win32")("on Windows", () => {
		it("converts an absolute path into a valid named pipe with no backslashes in the pipe name", () => {
			const inputPath = "C:\\temp\\socket.sock";
			const expectedPath = "\\\\?\\pipe\\C-temp-socket.sock";
			const result = getOSSocketPath(inputPath);
			expect(result).toBe(expectedPath);
			// The pipe name segment must not contain backslashes
			expect(result.slice("\\\\?\\pipe\\".length)).not.toContain("\\");
		});

		it("produces distinct pipe names for distinct paths", () => {
			expect(getOSSocketPath("C:\\a\\launchpad.sock")).not.toBe(
				getOSSocketPath("C:\\b\\launchpad.sock"),
			);
		});

		it("returns the same path if already in named pipe format with \\\\?\\pipe prefix", () => {
			const inputPath = "\\\\?\\pipe\\my_named_pipe";
			const result = getOSSocketPath(inputPath);
			expect(result).toBe(inputPath);
		});

		it("returns the same path if already in named pipe format with \\\\.\\pipe prefix", () => {
			const inputPath = "\\\\.\\pipe\\my_named_pipe";
			const result = getOSSocketPath(inputPath);
			expect(result).toBe(inputPath);
		});
	});
});

describe("isWindowsNamedPipe", () => {
	it("recognizes the \\\\?\\pipe\\ prefix", () => {
		expect(isWindowsNamedPipe("\\\\?\\pipe\\foo")).toBe(true);
	});

	it("recognizes the \\\\.\\pipe\\ prefix", () => {
		expect(isWindowsNamedPipe("\\\\.\\pipe\\foo")).toBe(true);
	});

	it("returns false for filesystem paths", () => {
		expect(isWindowsNamedPipe("C:\\temp\\socket.sock")).toBe(false);
		expect(isWindowsNamedPipe("/tmp/socket.sock")).toBe(false);
	});
});
