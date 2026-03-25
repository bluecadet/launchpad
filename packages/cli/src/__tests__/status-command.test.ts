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

describe("status command — real IPC", () => {
	let server: ServerHandle;
	let configPath: string;

	beforeAll(async () => {
		server = await spawnServerProcess();

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

	it("returns state from running daemon", async () => {
		const { status } = await import("../commands/status.js");

		const result = await status({ config: configPath });

		expect(result.isOk()).toBe(true);
		const state = result._unsafeUnwrap();
		expect(state).toMatchObject({
			system: expect.objectContaining({ mode: expect.any(String) }),
			plugins: expect.any(Object),
		});
	}, 15_000);
});
