import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js");
vi.mock("../env.js");
vi.mock("../cli-logger.js", async () => ({
	cliLogger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
	},
}));

import type { GlobalLaunchpadArgs } from "../../cli.js";
import { ConfigError } from "../../errors.js";
import { cliLogger } from "../cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../command-utils.js";
import { findFirstConfigRecursive, loadConfigFromFile } from "../config.js";
import { resolveEnv } from "../env.js";

describe("command-utils", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(loadConfigFromFile).mockResolvedValue({});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("loadConfigAndEnv", () => {
		it("returns ConfigError when findFirstConfigRecursive returns null and no argv.config", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue(null);

			const result = await loadConfigAndEnv({} as GlobalLaunchpadArgs);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConfigError);
		});

		it("uses argv.config directly when provided and does not call findFirstConfigRecursive", async () => {
			const argv: GlobalLaunchpadArgs = { config: "/explicit/launchpad.config.ts" };

			const result = await loadConfigAndEnv(argv);

			expect(findFirstConfigRecursive).not.toHaveBeenCalled();
			expect(result.isOk()).toBe(true);
		});

		it("calls resolveEnv with explicit paths when argv.env is provided", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");
			vi.stubEnv("INIT_CWD", "/root");

			const argv: GlobalLaunchpadArgs = { env: [".env.custom"] };

			await loadConfigAndEnv(argv);

			expect(resolveEnv).toHaveBeenCalledWith([path.resolve("/root", ".env.custom")]);
		});

		it("calls resolveEnv with cascade paths in correct order when argv.envCascade is provided", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");
			const configDir = "/project";

			const argv: GlobalLaunchpadArgs = { envCascade: "production" };

			await loadConfigAndEnv(argv);

			expect(resolveEnv).toHaveBeenCalledWith([
				path.resolve(configDir, ".env.production.local"),
				path.resolve(configDir, ".env.production"),
				path.resolve(configDir, ".env.local"),
				path.resolve(configDir, ".env"),
			]);
		});

		it("calls resolveEnv with default paths when neither env nor envCascade is provided", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");
			const configDir = "/project";

			await loadConfigAndEnv({} as GlobalLaunchpadArgs);

			expect(resolveEnv).toHaveBeenCalledWith([
				path.resolve(configDir, ".env.local"),
				path.resolve(configDir, ".env"),
			]);
		});

		it("returns { dir, config } where dir is dirname of config path", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");

			const result = await loadConfigAndEnv({} as GlobalLaunchpadArgs);

			expect(result.isOk()).toBe(true);
			const value = result._unsafeUnwrap();
			expect(value.dir).toBe("/project");
			expect(value.config).toBeDefined();
		});

		it("wraps loadConfigFromFile errors in ConfigError", async () => {
			vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");
			vi.mocked(loadConfigFromFile).mockRejectedValue(new Error("parse failure"));

			const result = await loadConfigAndEnv({} as GlobalLaunchpadArgs);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConfigError);
		});
	});

	describe("handleFatalError", () => {
		it("calls cliLogger.error with the error", () => {
			const error = new Error("fatal");
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit");
			});

			expect(() => handleFatalError(error)).toThrow("exit");
			expect(cliLogger.error).toHaveBeenCalledWith(error);

			exitSpy.mockRestore();
		});

		it("calls process.exit(1)", () => {
			const error = new Error("fatal");
			const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
				throw new Error("exit");
			});

			expect(() => handleFatalError(error)).toThrow("exit");
			expect(exitSpy).toHaveBeenCalledWith(1);

			exitSpy.mockRestore();
		});
	});
});
