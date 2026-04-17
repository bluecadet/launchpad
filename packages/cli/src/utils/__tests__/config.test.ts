import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jiti", () => ({ createJiti: vi.fn() }));
vi.mock("../cli-logger.js", async () => ({
	cliLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
	},
}));

import { createJiti } from "jiti";
import { findFirstConfigRecursive, loadConfigFromFile } from "../config.js";

describe("config", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vol.reset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("findFirstConfigRecursive", () => {
		it("finds launchpad.config.ts in INIT_CWD directory", () => {
			vi.stubEnv("INIT_CWD", "/some/path");
			vol.fromJSON({ "/some/path/launchpad.config.ts": "" });

			const result = findFirstConfigRecursive();

			expect(result).toBe("/some/path/launchpad.config.ts");
		});

		it("finds launchpad.config.js before launchpad.config.ts", () => {
			vi.stubEnv("INIT_CWD", "/some/path");
			vol.fromJSON({
				"/some/path/launchpad.config.ts": "",
				"/some/path/launchpad.config.js": "",
			});

			const result = findFirstConfigRecursive();

			expect(result).toBe("/some/path/launchpad.config.js");
		});

		it("walks up to parent directory when not in current dir", () => {
			vi.stubEnv("INIT_CWD", "/some/path/child");
			vol.fromJSON({ "/some/path/launchpad.config.ts": "" });

			const result = findFirstConfigRecursive();

			expect(result).toBe("/some/path/launchpad.config.ts");
		});

		it("returns null when no config exists in any parent", () => {
			vi.stubEnv("INIT_CWD", "/some/path");
			vol.fromJSON({ "/some/path/other-file.txt": "" });

			const result = findFirstConfigRecursive();

			expect(result).toBeNull();
		});

		it("uses process.cwd() when INIT_CWD is not set", () => {
			vi.stubEnv("INIT_CWD", "");
			// process.cwd() returns "/" due to global setup's process.chdir("/")
			vol.fromJSON({ "/launchpad.config.ts": "" });

			const result = findFirstConfigRecursive();

			expect(result).toBe("/launchpad.config.ts");
		});
	});

	describe("loadConfigFromFile", () => {
		it("returns {} when path is empty string", async () => {
			const result = await loadConfigFromFile("");
			expect(result).toEqual({});
		});

		it("returns the resolved value from jiti.import (the default export)", async () => {
			const mockConfig = { apps: [] };
			const mockJiti = { import: vi.fn().mockResolvedValue(mockConfig) };
			vi.mocked(createJiti).mockReturnValue(mockJiti as unknown as ReturnType<typeof createJiti>);

			const result = await loadConfigFromFile("/some/path/launchpad.config.ts");

			expect(result).toBe(mockConfig);
			expect(mockJiti.import).toHaveBeenCalledWith(expect.stringContaining("launchpad.config.ts"), {
				default: true,
			});
		});

		it("throws 'Unable to load config file' error when jiti.import throws", async () => {
			const jitiError = new Error("jiti parse error");
			const mockJiti = { import: vi.fn().mockRejectedValue(jitiError) };
			vi.mocked(createJiti).mockReturnValue(mockJiti as unknown as ReturnType<typeof createJiti>);

			await expect(loadConfigFromFile("/some/path/launchpad.config.ts")).rejects.toThrow(
				// chalk wraps the path in ANSI codes; .* tolerates them without requiring a TTY check
				/Unable to load config file '.*\/some\/path\/launchpad\.config\.ts.*'/,
			);
		});

		it("includes the original jiti error as .cause", async () => {
			const jitiError = new Error("jiti parse error");
			const mockJiti = { import: vi.fn().mockRejectedValue(jitiError) };
			vi.mocked(createJiti).mockReturnValue(mockJiti as unknown as ReturnType<typeof createJiti>);

			let thrownError: Error | undefined;
			try {
				await loadConfigFromFile("/some/path/launchpad.config.ts");
			} catch (e) {
				thrownError = e as Error;
			}

			expect(thrownError?.cause).toBe(jitiError);
		});
	});
});
