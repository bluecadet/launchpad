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

import { start } from "../commands/start.js";
import { run } from "../run.js";
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
});
