// These vi.unmock calls are hoisted by Vitest before any imports.
// They override the global memfs mocks from setup.ts so integration tests
// use the real filesystem.
vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerHandle } from "./helpers/process-helpers.js";
import { spawnServerProcess } from "./helpers/process-helpers.js";

describe("stop command — real IPC", () => {
	let server: ServerHandle;
	let configPath: string;

	beforeAll(async () => {
		server = await spawnServerProcess();

		// Write a minimal config file that points to the absolute socket + pid file paths.
		// Using .js extension so jiti can load it without TypeScript compilation.
		configPath = path.join(server.runDir, "launchpad.config.js");
		fs.writeFileSync(
			configPath,
			`export default {
  controller: {
    socketPath: ${JSON.stringify(server.socketPath)},
    pidFile: ${JSON.stringify(server.pidFile)},
  },
};
`,
		);
	}, 15_000);

	afterAll(async () => {
		await server.teardown();
	});

	it("gracefully stops the running controller via IPC", async () => {
		const { stop } = await import("../commands/stop.js");

		const result = await stop({ config: configPath });

		expect(result.isOk()).toBe(true);

		// After stop, the pid file should have been deleted by the stop command
		const deadline = Date.now() + 5_000;
		let pidFileGone = false;
		while (Date.now() < deadline) {
			if (!fs.existsSync(server.pidFile)) {
				pidFileGone = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 100));
		}

		expect(pidFileGone).toBe(true);
	}, 15_000);
});
