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

		// Write a minimal config pointing at the fixture's socket + pid file.
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

	it("sends shutdown via IPC and deletes pid file when process exits", async () => {
		const { stop } = await import("../commands/stop.js");

		const result = await stop({ config: configPath });

		expect(result.isOk()).toBe(true);
		// The fixture exits on shutdown; stop.ts deletes the pid file once isProcessRunning() is false.
		expect(fs.existsSync(server.pidFile)).toBe(false);
	}, 15_000);
});
