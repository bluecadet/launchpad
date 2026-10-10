import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

import { controllerConfigSchema } from "../controller-config.js";
import { controllerInstanceLockPath } from "../core/controller-instance-lease.js";
import { LaunchpadController } from "../launchpad-controller.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

it("allows only one task or persistent controller for a configured project identity", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-controller-lock-"));
	directories.push(directory);
	const config = controllerConfigSchema.parse({
		pidFile: ".runtime/controller.pid",
		socketPath: ".runtime/controller.sock",
		logging: { dirname: "logs", overrideConsole: false },
	});
	const taskController = new LaunchpadController(config, directory, "task");
	expect(() => new LaunchpadController(config, directory, "persistent")).toThrow(
		/another controller is already active/i,
	);

	expect((await taskController.start()).isOk()).toBe(true);
	expect((await taskController.stop()).isOk()).toBe(true);

	const successor = new LaunchpadController(config, directory, "task");
	expect((await successor.start()).isOk()).toBe(true);
	expect((await successor.stop()).isOk()).toBe(true);

	const lockPath = controllerInstanceLockPath(path.resolve(directory, config.pidFile));
	await expect(stat(lockPath)).resolves.toBeDefined();
});
