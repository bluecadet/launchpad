import path from "node:path";
import {
	controllerConfigSchema,
	type ResolvedControllerConfig,
} from "@bluecadet/launchpad-controller/config";
import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import { fs } from "memfs";
import { err, errAsync, ok, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DaemonNotRunningError,
	withDaemon,
	withDaemonOrController,
} from "../controller-execution.js";

vi.mock("@bluecadet/launchpad-controller", () => ({
	LaunchpadController: vi.fn(),
}));
vi.mock("@bluecadet/launchpad-controller/ipc-client", () => ({
	IPCClient: vi.fn(),
}));
vi.mock("@bluecadet/launchpad-controller/pid-utils", () => ({
	getDaemonPid: vi.fn(),
}));

import { LaunchpadController } from "@bluecadet/launchpad-controller";
import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { getDaemonPid } from "@bluecadet/launchpad-controller/pid-utils";
import { cliLogger } from "../cli-logger.js";

vi.mock("../cli-logger.js", async () => {
	return {
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
	};
});

describe("controller-execution", () => {
	const baseDir = "/test/base";
	const controllerConfig: ResolvedControllerConfig = controllerConfigSchema.parse({
		pidFile: "pid",
		socketPath: "socket",
	});

	const createMockIPCClient = (
		connectResult: ResultAsync<unknown, unknown> = okAsync(undefined),
	) => ({
		connect: vi.fn().mockReturnValue(connectResult),
		disconnect: vi.fn(),
		on: vi.fn(),
	});

	const createMockController = (
		startResult: ResultAsync<unknown, unknown> = okAsync(undefined),
		stopResult: ResultAsync<unknown, unknown> = okAsync(undefined),
	) => ({
		start: vi.fn().mockReturnValue(startResult),
		stop: vi.fn().mockReturnValue(stopResult),
		getEventBus: vi.fn().mockReturnValue(createMockEventBus()),
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
			const mockClient = createMockIPCClient();
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);
			const operation = vi.fn().mockReturnValue(okAsync("result"));

			const result = await withDaemon(baseDir, controllerConfig, false, operation);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(mockClient.connect).toHaveBeenCalledWith(path.resolve(baseDir, "socket"));
			expect(operation).toHaveBeenCalledWith(mockClient, 12345);
			expect(mockClient.disconnect).toHaveBeenCalled();
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
			const mockClient = createMockIPCClient();
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);
			const operation = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemon(baseDir, controllerConfig, false, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(operation).toHaveBeenCalledWith(mockClient, 12345);
		});

		it("should return error if connect fails", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));
			const mockClient = createMockIPCClient(errAsync(new Error("Connect failed")));
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);
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
			const mockClient = createMockIPCClient();
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);
			const ifDaemon = vi.fn().mockReturnValue(okAsync("daemon-result"));
			const otherwise = vi.fn();

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon,
				otherwise,
			});

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("daemon-result");
			expect(ifDaemon).toHaveBeenCalledWith(mockClient, 12345);
			expect(otherwise).not.toHaveBeenCalled();
			expect(mockClient.disconnect).toHaveBeenCalled();
		});

		it.each([
			["task", true],
			["persistent", false],
		] as const)("should use local controller if daemon is not running in %s mode", async (mode, shouldStop) => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const mockController = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);
			const ifDaemon = vi.fn();
			const otherwise = vi.fn().mockReturnValue(okAsync("local-result"));

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode,
				ifDaemon,
				otherwise,
			});

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("local-result");
			expect(ifDaemon).not.toHaveBeenCalled();
			expect(otherwise).toHaveBeenCalledWith(mockController);
			expect(mockController.start).toHaveBeenCalled();
			if (shouldStop) {
				expect(mockController.stop).toHaveBeenCalled();
			} else {
				expect(mockController.stop).not.toHaveBeenCalled();
			}
		});

		it("should stop controller in task mode but not in persistent mode", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const mockController = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);
			const otherwise = vi.fn().mockReturnValue(okAsync("result"));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(mockController.stop).toHaveBeenCalled();

			vi.clearAllMocks();
			const mockController2 = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController2 as any);
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			await withDaemonOrController(baseDir, controllerConfig, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(mockController2.stop).not.toHaveBeenCalled();
		});

		it("should return error if controller start fails", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const mockController = createMockController(errAsync(new Error("Start failed")));
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

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
			const mockController = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);
			const otherwise = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemonOrController(baseDir, controllerConfig, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(mockController.start).toHaveBeenCalled();
		});

		it("should pass correct mode to LaunchpadController", async () => {
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));
			const mockController = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);
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
			const mockClient = createMockIPCClient();
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

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
			const mockController = createMockController();
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

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
