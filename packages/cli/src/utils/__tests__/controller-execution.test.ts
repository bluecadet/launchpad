import type { ControllerConfig } from "@bluecadet/launchpad-controller";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { fs } from "memfs";
import { err, errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DaemonNotRunningError,
	withDaemon,
	withDaemonOrController,
} from "../controller-execution.js";

vi.mock("@bluecadet/launchpad-controller", () => ({
	IPCClient: vi.fn(),
	LaunchpadController: vi.fn(),
	getDaemonPid: vi.fn(),
}));

// Import mocked modules
import * as ControllerModule from "@bluecadet/launchpad-controller";

const { IPCClient, LaunchpadController, getDaemonPid } = ControllerModule;

describe("controller-execution", () => {
	const baseDir = "/test/base";
	const controllerConfig: ControllerConfig = {
		pidFile: "pid",
		socketPath: "socket",
	};
	const logger = createMockLogger();

	beforeEach(() => {
		vi.clearAllMocks();
		// Setup basic directory structure
		fs.mkdirSync(baseDir, { recursive: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("withDaemon", () => {
		it("should execute operation with connected IPC client when daemon is running", async () => {
			// Mock getDaemonPid to return a valid PID
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			// Mock IPCClient
			const mockClient = {
				connect: vi.fn().mockReturnValue(okAsync(undefined)),
				disconnect: vi.fn(),
			};
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

			const operation = vi.fn().mockReturnValue(okAsync("result"));

			const result = await withDaemon(baseDir, controllerConfig, operation);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(mockClient.connect).toHaveBeenCalledWith(`${baseDir}/socket`);
			expect(operation).toHaveBeenCalledWith(mockClient, 12345);
			expect(mockClient.disconnect).toHaveBeenCalled();
		});

		it("should return DaemonNotRunningError when PID file does not exist", async () => {
			// Mock getDaemonPid to return null (no daemon)
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const operation = vi.fn();

			const result = await withDaemon(baseDir, controllerConfig, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(DaemonNotRunningError);
			expect(operation).not.toHaveBeenCalled();
		});

		it("should return DaemonNotRunningError when getDaemonPid returns error", async () => {
			// Mock getDaemonPid to return error
			vi.mocked(getDaemonPid).mockReturnValue(err(new Error("Failed to read PID")));

			const operation = vi.fn();

			const result = await withDaemon(baseDir, controllerConfig, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(DaemonNotRunningError);
			expect(operation).not.toHaveBeenCalled();
		});

		it("should propagate operation errors", async () => {
			// Mock getDaemonPid to return a valid PID
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			const mockClient = {
				connect: vi.fn().mockReturnValue(okAsync(undefined)),
				disconnect: vi.fn(),
			};
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

			const operation = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemon(baseDir, controllerConfig, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(operation).toHaveBeenCalledWith(mockClient, 12345);
		});

		it("should return error if connect fails", async () => {
			// Mock getDaemonPid to return a valid PID
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			const mockClient = {
				connect: vi.fn().mockReturnValue(errAsync(new Error("Connect failed"))),
				disconnect: vi.fn(),
			};
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

			const operation = vi.fn();

			const result = await withDaemon(baseDir, controllerConfig, operation);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Connect failed");
			expect(operation).not.toHaveBeenCalled();
		});
	});

	describe("withDaemonOrController", () => {
		it("should use daemon via IPC if daemon is running", async () => {
			// Mock getDaemonPid to return a valid PID
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			const mockClient = {
				connect: vi.fn().mockReturnValue(okAsync(undefined)),
				disconnect: vi.fn(),
			};
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

			const ifDaemon = vi.fn().mockReturnValue(okAsync("daemon-result"));
			const otherwise = vi.fn();

			const result = await withDaemonOrController(baseDir, controllerConfig, logger, {
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

		it("should use local controller if daemon is not running in task mode", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const ifDaemon = vi.fn();
			const otherwise = vi.fn().mockReturnValue(okAsync("local-result"));

			const result = await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "task",
				ifDaemon,
				otherwise,
			});

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("local-result");
			expect(ifDaemon).not.toHaveBeenCalled();
			expect(otherwise).toHaveBeenCalledWith(mockController);
			expect(mockController.start).toHaveBeenCalled();
			expect(mockController.stop).toHaveBeenCalled();
		});

		it("should use local controller if daemon is not running in persistent mode", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const ifDaemon = vi.fn();
			const otherwise = vi.fn().mockReturnValue(okAsync("local-result"));

			const result = await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "persistent",
				ifDaemon,
				otherwise,
			});

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("local-result");
			expect(mockController.start).toHaveBeenCalled();
			// In persistent mode, stop should NOT be called
			expect(mockController.stop).not.toHaveBeenCalled();
		});

		it("should stop controller in task mode but not in persistent mode", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const otherwise = vi.fn().mockReturnValue(okAsync("result"));

			// Test task mode
			await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(mockController.stop).toHaveBeenCalled();

			// Reset mocks
			vi.clearAllMocks();
			mockController.start = vi.fn().mockReturnValue(okAsync(undefined));
			mockController.stop = vi.fn().mockReturnValue(okAsync(undefined));
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			// Test persistent mode
			await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise,
			});
			expect(mockController.stop).not.toHaveBeenCalled();
		});

		it("should return error if controller start fails", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(errAsync(new Error("Start failed"))),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const result = await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise: vi.fn(),
			});

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Start failed");
		});

		it("should propagate operation errors in task mode", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const otherwise = vi.fn().mockReturnValue(errAsync(new Error("Operation failed")));

			const result = await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "task",
				ifDaemon: vi.fn(),
				otherwise,
			});

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Operation failed");
			expect(mockController.start).toHaveBeenCalled();
		});

		it("should pass correct mode to LaunchpadController", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			const otherwise = vi.fn().mockReturnValue(okAsync("result"));

			await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise,
			});

			expect(LaunchpadController).toHaveBeenCalledWith(
				controllerConfig,
				logger,
				baseDir,
				"persistent",
			);
		});

		it("should log when using daemon", async () => {
			// Mock getDaemonPid to return a valid PID
			vi.mocked(getDaemonPid).mockReturnValue(ok(12345));

			const mockClient = {
				connect: vi.fn().mockReturnValue(okAsync(undefined)),
				disconnect: vi.fn(),
			};
			vi.mocked(IPCClient).mockImplementation(() => mockClient as any);

			await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "task",
				ifDaemon: vi.fn().mockReturnValue(okAsync(undefined)),
				otherwise: vi.fn(),
			});

			expect(logger.info).toHaveBeenCalledWith("Daemon is running, delegating to daemon via IPC");
		});

		it("should log when starting local controller", async () => {
			// Mock getDaemonPid to return no daemon
			vi.mocked(getDaemonPid).mockReturnValue(ok(null));

			const mockController = {
				start: vi.fn().mockReturnValue(okAsync(undefined)),
				stop: vi.fn().mockReturnValue(okAsync(undefined)),
			};
			vi.mocked(LaunchpadController).mockImplementation(() => mockController as any);

			await withDaemonOrController(baseDir, controllerConfig, logger, {
				mode: "persistent",
				ifDaemon: vi.fn(),
				otherwise: vi.fn().mockReturnValue(okAsync(undefined)),
			});

			expect(logger.info).toHaveBeenCalledWith(
				"Daemon is not running, starting controller in persistent mode",
			);
		});
	});
});
