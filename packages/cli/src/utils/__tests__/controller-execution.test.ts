import path from "node:path";
import {
	controllerConfigSchema,
	type ResolvedControllerConfig,
} from "@bluecadet/launchpad-controller/config";
import { fs } from "memfs";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DaemonNotRunningError,
	withDaemon,
	withDaemonOrController,
} from "../controller-execution.js";

vi.mock(import("@bluecadet/launchpad-controller"), () => {
	const LaunchpadController = vi.fn(
		class {
			start = vi.fn().mockReturnValue(okAsync(undefined));
			stop = vi.fn().mockReturnValue(okAsync(undefined));
			getEventBus = vi.fn().mockReturnValue({ on: vi.fn() });
		},
	);
	return { LaunchpadController } as any;
});

vi.mock(import("@bluecadet/launchpad-controller/ipc-client"), () => {
	const IPCClient = vi.fn(
		class {
			connect = vi.fn().mockReturnValue(okAsync(undefined));
			disconnect = vi.fn();
			on = vi.fn();
		},
	);
	return { IPCClient } as any;
});

vi.mock(import("@bluecadet/launchpad-controller/pid-utils"), () => ({
	getDaemonPid: vi.fn(),
}));

import { LaunchpadController } from "@bluecadet/launchpad-controller";
import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { getDaemonPid } from "@bluecadet/launchpad-controller/pid-utils";
import { cliLogger } from "../cli-logger.js";

vi.mock(import("../cli-logger.js"), () => ({
	cliLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		fromPayload: vi.fn(),
		setLevel: vi.fn(),
		fixed: vi.fn(),
	},
}));

describe("controller-execution", () => {
	const baseDir = "/test/base";
	const controllerConfig: ResolvedControllerConfig = controllerConfigSchema.parse({
		pidFile: "pid",
		socketPath: "socket",
	});

	beforeEach(() => {
		vi.clearAllMocks();
		fs.mkdirSync(baseDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("withDaemon", () => {
		it("should execute operation with connected IPC client when daemon is running", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));
			const operation = vi.fn().mockReturnValue(okAsync("result"));

			const result = await withDaemon(baseDir, controllerConfig, false, operation);
			const client = vi.mocked(IPCClient).mock.instances[0]!;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(client.connect).toHaveBeenCalledWith(path.resolve(baseDir, "socket"));
			expect(operation).toHaveBeenCalledWith(client, 12345);
			expect(client.disconnect).toHaveBeenCalled();
		});

		it.each([
			["PID file does not exist", ok(null)],
			["getDaemonPid returns error", err(new Error("Failed to read PID"))],
		])("should return DaemonNotRunningError when %s", async (_, pidResult) => {
			vi.mocked(getDaemonPid).mockReturnValue(pidResult as any);
			const operation = vi.fn();

			const result = await withDaemon(baseDir, controllerConfig, false, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(DaemonNotRunningError);
			expect(operation).not.toHaveBeenCalled();
		});

		it("should propagate operation errors", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));
			const operation = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemon(baseDir, controllerConfig, false, operation);
			const client = vi.mocked(IPCClient).mock.instances[0];

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(operation).toHaveBeenCalledWith(client, 12345);
		});

		it("should return error if connect fails", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));
			vi.mocked(IPCClient).mockImplementationOnce(
				class {
					connect = vi.fn().mockReturnValue(errAsync(new Error("Connect failed")));
					disconnect = vi.fn();
					on = vi.fn();
				} as any,
			);
			const operation = vi.fn();

			const result = await withDaemon(baseDir, controllerConfig, false, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Connect failed");
			expect(operation).not.toHaveBeenCalled();
		});
	});

	describe("withDaemonOrController", () => {
		it("should use daemon via IPC if daemon is running", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));
			const ifDaemon = vi.fn().mockReturnValue(okAsync("daemon-result"));
			const otherwise = vi.fn();

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon,
				otherwise,
			});
			const client = vi.mocked(IPCClient).mock.instances[0]!;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("daemon-result");
			expect(ifDaemon).toHaveBeenCalledWith(client, 12345);
			expect(otherwise).not.toHaveBeenCalled();
			expect(client.disconnect).toHaveBeenCalled();
		});

		it.each([
			["task", true],
			["persistent", false],
		] as const)("should use local controller if daemon is not running in %s mode", async (mode, shouldStop) => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const ifDaemon = vi.fn();
			const otherwise = vi.fn().mockReturnValue(okAsync("local-result"));

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode,
				ifDaemon,
				otherwise,
			});
			const controller = vi.mocked(LaunchpadController).mock.instances[0]!;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("local-result");
			expect(ifDaemon).not.toHaveBeenCalled();
			expect(otherwise).toHaveBeenCalledWith(controller);
			expect(controller.start).toHaveBeenCalled();
			if (shouldStop) {
				expect(controller.stop).toHaveBeenCalled();
			} else {
				expect(controller.stop).not.toHaveBeenCalled();
			}
		});

		it("should stop controller in task mode but not in persistent mode", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const otherwise = vi.fn().mockReturnValue(okAsync("result"));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(vi.mocked(LaunchpadController).mock.instances[0]!.stop).toHaveBeenCalled();

			vi.clearAllMocks();
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(vi.mocked(LaunchpadController).mock.instances[0]!.stop).not.toHaveBeenCalled();
		});

		it("should return error if controller start fails", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			vi.mocked(LaunchpadController).mockImplementationOnce(
				class {
					start = vi.fn().mockReturnValue(errAsync(new Error("Start failed")));
					stop = vi.fn();
					getEventBus = vi.fn().mockReturnValue({ on: vi.fn() });
				} as any,
			);

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise: vi.fn(),
			});

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Start failed");
		});

		it("should propagate operation errors in task mode", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const otherwise = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});
			const controller = vi.mocked(LaunchpadController).mock.instances[0]!;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(controller.start).toHaveBeenCalled();
		});

		it("should pass correct mode to LaunchpadController", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const otherwise = vi.fn().mockReturnValue(okAsync("result"));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise,
			});

			expect(LaunchpadController).toHaveBeenCalledWith(controllerConfig, baseDir, "persistent");
		});

		it("should log when using daemon", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn().mockReturnValue(okAsync(undefined)),
				otherwise: vi.fn(),
			});

			expect(cliLogger.info).toHaveBeenCalledWith(
				"Daemon is running, delegating to daemon via IPC",
			);
		});

		it("should log when starting local controller", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise: vi.fn().mockReturnValue(okAsync(undefined)),
			});

			expect(cliLogger.info).toHaveBeenCalledWith(
				"Daemon is not running, starting controller in persistent mode",
			);
		});
	});
});
