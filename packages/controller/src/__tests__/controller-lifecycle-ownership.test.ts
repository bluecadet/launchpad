import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { definePlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { okAsync, ResultAsync } from "neverthrow";
import { afterEach, expect, it, vi } from "vitest";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

import { controllerConfigSchema } from "../controller-config.js";
import {
	acquireControllerInstanceLease,
	controllerInstanceLockPath,
} from "../core/controller-instance-lease.js";
import { LaunchpadController } from "../launchpad-controller.js";
import { getOSSocketPath } from "../utils/ipc-utils.js";

const directories: string[] = [];

async function project() {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-lifecycle-"));
	directories.push(directory);
	const config = controllerConfigSchema.parse({
		socketPath: "controller.sock",
		logging: { overrideConsole: false, text: { enabled: false } },
	});
	return { directory, config };
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

it("returns native contention through start and registration, without constructor throws", async () => {
	const { directory, config } = await project();
	const owner = new LaunchpadController(config, directory);
	await owner.start();
	let contender: LaunchpadController | undefined;
	try {
		expect(() => {
			contender = new LaunchpadController(config, directory);
		}).not.toThrow();
		if (!contender) throw new Error("Expected contender");
		const setup = vi.fn(() => okAsync({}));
		const registration = await contender.registerPlugin(definePlugin({ name: "worker", setup }));
		expect(registration.isErr()).toBe(true);
		expect(setup).not.toHaveBeenCalled();
		const result = await contender.start();
		expect(result.isErr()).toBe(true);
		if (result.isErr())
			expect(result.error.message).toMatch(/another controller is already active/i);
	} finally {
		await contender?.stop();
		await owner.stop();
	}
});

it("shares overlapping persistent startup and retains ownership while the IPC server is active", async () => {
	const { directory, config } = await project();
	const controller = new LaunchpadController(config, directory, "persistent");
	let contender: LaunchpadController | undefined;
	try {
		const firstStart = controller.start();
		const secondStart = controller.start();
		expect(secondStart).toBe(firstStart);
		const results = await Promise.all([firstStart, secondStart]);
		expect(results.every((result) => result.isOk())).toBe(true);
		expect(controller.isStarted()).toBe(true);
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(getOSSocketPath(path.join(directory, config.socketPath)));
			socket.once("error", reject);
			socket.once("connect", () => {
				socket.destroy();
				resolve();
			});
		});
		contender = new LaunchpadController(config, directory);
		expect((await contender.start()).isErr()).toBe(true);
	} finally {
		await contender?.stop();
		await controller.stop();
	}
});

it("aborts and awaits pre-start plugins on occupied IPC startup before releasing ownership", async () => {
	const { directory, config } = await project();
	const server = net.createServer((socket) => socket.end());
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(getOSSocketPath(path.join(directory, config.socketPath)), resolve);
	});
	const controller = new LaunchpadController(config, directory, "persistent");
	let finishDisconnect: (() => void) | undefined;
	let disconnectStarted: (() => void) | undefined;
	const disconnecting = new Promise<void>((resolve) => {
		disconnectStarted = resolve;
	});
	const pendingDisconnect = new Promise<void>((resolve) => {
		finishDisconnect = resolve;
	});
	const disconnect = vi.fn(() => {
		expect(controller.getAbortSignal().aborted).toBe(true);
		disconnectStarted?.();
		return ResultAsync.fromSafePromise(pendingDisconnect);
	});
	await controller.registerPlugin(
		definePlugin({ name: "worker", setup: () => okAsync({ disconnect }) }),
	);
	try {
		const startup = controller.start();
		// A failed startup must begin cleanup rather than resolve while workers remain alive.
		await Promise.race([disconnecting, startup]);
		expect(disconnect).toHaveBeenCalledOnce();
		const contender = new LaunchpadController(config, directory);
		try {
			expect((await contender.start()).isErr()).toBe(true);
		} finally {
			await contender.stop();
		}
		finishDisconnect?.();
		expect((await startup).isErr()).toBe(true);
		expect((await controller.stop()).isOk()).toBe(true);
		expect(disconnect).toHaveBeenCalledOnce();
		const successor = new LaunchpadController(config, directory);
		try {
			expect((await successor.start()).isOk()).toBe(true);
		} finally {
			await successor.stop();
		}
	} finally {
		finishDisconnect?.();
		await controller.stop();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

it.each([false, true])(
	"disposes pre-start registration resources, including failed setup (%s)",
	async (failSetup) => {
		const { directory, config } = await project();
		const controller = new LaunchpadController(config, directory);
		const disconnect = vi.fn(() => okAsync(undefined));
		await controller.registerPlugin(
			definePlugin({ name: "worker", setup: () => okAsync({ disconnect }) }),
		);
		if (failSetup) {
			await controller.registerPlugin(
				definePlugin({
					name: "bad",
					setup: () => {
						throw new Error("setup failed");
					},
				}),
			);
		}
		try {
			expect((await controller.stop()).isOk()).toBe(true);
			expect(controller.getAbortSignal().aborted).toBe(true);
			expect(disconnect).toHaveBeenCalledOnce();
			const successor = new LaunchpadController(config, directory);
			try {
				expect((await successor.start()).isOk()).toBe(true);
			} finally {
				await successor.stop();
			}
			expect((await controller.start()).isErr()).toBe(true);
			expect(
				(
					await controller.registerPlugin(definePlugin({ name: "late", setup: () => okAsync({}) }))
				).isErr(),
			).toBe(true);
		} finally {
			await controller.stop();
		}
	},
);

it("serializes concurrent stop with persistent startup and does not permit restart", async () => {
	const { directory, config } = await project();
	const controller = new LaunchpadController(config, directory, "persistent");
	const starting = controller.start();
	const stopping = controller.stop();
	expect(controller.stop()).toBe(stopping);
	expect((await controller.start()).isErr()).toBe(true);
	expect((await starting).isOk()).toBe(true);
	expect((await stopping).isOk()).toBe(true);
	expect(controller.isStarted()).toBe(false);
	expect(controller.getAbortSignal().aborted).toBe(true);
	expect((await controller.start()).isErr()).toBe(true);
	const successor = new LaunchpadController(config, directory, "persistent");
	try {
		expect((await successor.start()).isOk()).toBe(true);
	} finally {
		await successor.stop();
	}
});

it("awaits in-flight pre-start registration before disconnecting and releasing ownership", async () => {
	const { directory, config } = await project();
	const controller = new LaunchpadController(config, directory);
	let finishSetup = () => {};
	const setupGate = new Promise<void>((resolve) => {
		finishSetup = resolve;
	});
	const disconnect = vi.fn(() => okAsync(undefined));
	const registration = controller.registerPlugin(
		definePlugin({
			name: "slow-worker",
			setup: () => ResultAsync.fromSafePromise(setupGate).map(() => ({ disconnect })),
		}),
	);
	const stopping = controller.stop();
	const contender = new LaunchpadController(config, directory);
	try {
		expect((await contender.start()).isErr()).toBe(true);
		expect(disconnect).not.toHaveBeenCalled();
		finishSetup();
		expect((await registration).isOk()).toBe(true);
		expect((await stopping).isOk()).toBe(true);
		expect(disconnect).toHaveBeenCalledOnce();
		const successor = new LaunchpadController(config, directory);
		try {
			expect((await successor.start()).isOk()).toBe(true);
		} finally {
			await successor.stop();
		}
	} finally {
		finishSetup();
		await stopping;
		await contender.stop();
	}
});

it("returns filesystem lease acquisition failures as Results", async () => {
	const { directory, config } = await project();
	const pidFile = path.resolve(directory, config.pidFile);
	await mkdir(controllerInstanceLockPath(pidFile), { recursive: true });
	const lease = acquireControllerInstanceLease(pidFile, directory);
	expect(lease.isErr()).toBe(true);
	if (lease.isErr())
		expect(lease.error.message).toMatch(/could not acquire the native controller instance lock/i);
	const controller = new LaunchpadController(config, directory);
	expect((await controller.start()).isErr()).toBe(true);
	expect((await controller.stop()).isOk()).toBe(true);
});
