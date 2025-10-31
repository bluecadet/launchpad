import { describe, expect, it } from "vitest";
import { getOSSocketPath } from "../ipc-utils.js";

describe("getOSSocketPath", () => {
  describe.runIf(process.platform !== "win32")("on posix", () => {
    it("returns the same path", () => {
      const inputPath = "/tmp/socket.sock";
      const result = getOSSocketPath(inputPath);
      expect(result).toBe(inputPath);
    });
  });

  describe.runIf(process.platform === "win32")("on Windows", () => {
    it('updates the path to use named pipe format if not already in that format', () => {
      const inputPath = "C:\\temp\\socket.sock";
      const expectedPath = "\\\\?\\pipe\\C:\\temp\\socket.sock";
      const result = getOSSocketPath(inputPath);
      expect(result).toBe(expectedPath);
    });

    it('returns the same path if already in named pipe format with \\\\?\\pipe prefix', () => {
      const inputPath = "\\\\?\\pipe\\my_named_pipe";
      const result = getOSSocketPath(inputPath);
      expect(result).toBe(inputPath);
    });
  });
})