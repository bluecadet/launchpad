import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/config.js");
vi.mock("../utils/env.js");
vi.mock("../utils/cli-logger.js", () => ({
	cliLogger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
		setLevel: vi.fn(),
	},
}));
vi.mock("../commands/start.js", () => ({ start: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../commands/stop.js", () => ({ stop: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../commands/status.js", () => ({ status: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../utils/command-utils.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/command-utils.js")>();
	return {
		...actual,
		handleFatalError: vi.fn(() => {
			throw new Error("fatal");
		}),
	};
});

import { start } from "../commands/start.js";
import { run } from "../run.js";
import { handleFatalError } from "../utils/command-utils.js";
import { findFirstConfigRecursive, loadConfigFromFile } from "../utils/config.js";
import { resolveEnv } from "../utils/env.js";

describe("cli run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(findFirstConfigRecursive).mockReturnValue("/project/launchpad.config.ts");
		vi.mocked(loadConfigFromFile).mockResolvedValue({});
	});

	it("discovers config, loads env, and compiles config exactly once when running a command", async () => {
		await run(["start"]);

		// The double-load bug called each of these twice (once for plugin CLI
		// discovery, once inside the command handler). They must each run once.
		expect(findFirstConfigRecursive).toHaveBeenCalledTimes(1);
		expect(resolveEnv).toHaveBeenCalledTimes(1);
		expect(loadConfigFromFile).toHaveBeenCalledTimes(1);

		// And the command received the config resolved by the entry point (dirname
		// of the discovered config path) rather than loading its own.
		expect(start).toHaveBeenCalledTimes(1);
		expect(start).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ dir: "/project" }),
		);
	});

	it.each([
		{ argv: ["--env", ".env", "start"], optionType: "array-valued" },
		{ argv: ["--verbose", "start"], optionType: "count" },
	])("runs a command after a $optionType global option", async ({ argv }) => {
		await run(argv);

		expect(start).toHaveBeenCalledTimes(1);
	});

	it("reports a command handler error without printing usage text", async () => {
		// yargs' default .fail() dumps the command's usage/help before the error,
		// which buried runtime errors (e.g. IPC serialization failures) in noise.
		const handlerError = new Error("Cannot stringify arbitrary non-POJOs");
		vi.mocked(start).mockRejectedValueOnce(handlerError);
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		// yargs swallows exceptions thrown by .fail() for async handlers and
		// re-rejects with the original error; in production handleFatalError
		// exits the process before that matters.
		await expect(run(["start"])).rejects.toThrow("Cannot stringify arbitrary non-POJOs");

		expect(handleFatalError).toHaveBeenCalledWith(handlerError);
		expect(consoleLogSpy).not.toHaveBeenCalled();

		consoleLogSpy.mockRestore();
	});
});
