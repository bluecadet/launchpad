vi.mock("../../utils/command-utils.js");
vi.mock("../../utils/controller-execution.js");
vi.mock("../../utils/cli-logger.js", async () => ({
	cliLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
		fromPayload: vi.fn(),
		setLevel: vi.fn(),
	},
}));
vi.mock("@bluecadet/launchpad-controller/pid-utils", () => ({
	isProcessRunning: vi.fn().mockReturnValue(false),
	deletePidFile: vi.fn(),
	getDaemonPid: vi.fn(),
}));
vi.mock("@bluecadet/launchpad-monitor/launchpad-monitor", async () => {
	const { okAsync } = await import("neverthrow");
	return {
		killPM2: vi.fn().mockReturnValue(okAsync(undefined)),
	};
});

import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { deletePidFile, isProcessRunning } from "@bluecadet/launchpad-controller/pid-utils";
import { killPM2 } from "@bluecadet/launchpad-monitor/launchpad-monitor";
import { createMockIPCClient } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import { ConfigError, IPCConnectionError } from "../../errors.js";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
import { cliLogger } from "../../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../../utils/command-utils.js";
import { DaemonNotRunningError, withDaemon } from "../../utils/controller-execution.js";
import { stop } from "../stop.js";

const mockControllerConfig = controllerConfigSchema.parse({});
const mockConfig = resolveLaunchpadConfig({ controller: mockControllerConfig });

describe("stop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(loadConfigAndEnv).mockReturnValue(okAsync({ dir: "/test", config: mockConfig }));
		vi.mocked(handleFatalError).mockImplementation(() => {
			throw new Error("fatal");
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("IPC shutdown succeeds and process stops — deletePidFile called, result is Ok", async () => {
		const mockClient = createMockIPCClient();
		vi.mocked(isProcessRunning).mockReturnValue(false);

		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		const resultPromise = stop({});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.isOk()).toBe(true);
		expect(mockClient.shutdown).toHaveBeenCalled();
		expect(vi.mocked(deletePidFile)).toHaveBeenCalled();
	});

	it("daemon not running (no monitor plugin) — handleFatalError is called", async () => {
		vi.mocked(withDaemon).mockReturnValue(errAsync(new DaemonNotRunningError()));

		await expect(stop({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalledWith(expect.any(DaemonNotRunningError));
	});

	it("loadConfigAndEnv fails — handleFatalError called", async () => {
		vi.mocked(loadConfigAndEnv).mockReturnValue(errAsync(new ConfigError("config load failed")));

		await expect(stop({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});

	it("process still running after IPC shutdown — SIGTERM sent, then process stops", async () => {
		const mockClient = createMockIPCClient();
		vi.mocked(isProcessRunning)
			.mockReturnValueOnce(true) // still running after shutdown + wait
			.mockReturnValueOnce(false); // stopped after SIGTERM + wait
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

		const resultPromise = stop({});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.isOk()).toBe(true);
		expect(killSpy).toHaveBeenCalledWith(999, "SIGTERM");
		expect(vi.mocked(deletePidFile)).toHaveBeenCalled();
	});

	it("process still running after SIGTERM — SIGKILL sent, force-stop warning logged", async () => {
		const mockClient = createMockIPCClient();
		vi.mocked(isProcessRunning)
			.mockReturnValueOnce(true) // still running after shutdown
			.mockReturnValueOnce(true); // still running after SIGTERM
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

		const resultPromise = stop({});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.isOk()).toBe(true);
		expect(killSpy).toHaveBeenCalledWith(999, "SIGTERM");
		expect(killSpy).toHaveBeenCalledWith(999, "SIGKILL");
		expect(vi.mocked(deletePidFile)).toHaveBeenCalled();
		expect(vi.mocked(cliLogger.warn)).toHaveBeenCalledWith(
			expect.stringContaining("force stopped"),
		);
	});

	it("process.kill throws on SIGTERM — error propagated to handleFatalError", async () => {
		const mockClient = createMockIPCClient();
		vi.mocked(isProcessRunning).mockReturnValueOnce(true);
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw new Error("EPERM");
		});

		const resultPromise = stop({});
		await vi.runAllTimersAsync();
		await expect(resultPromise).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});

	it("withDaemon fails with non-DaemonNotRunningError — handleFatalError called", async () => {
		vi.mocked(withDaemon).mockReturnValue(errAsync(new IPCConnectionError("IPC connection reset")));

		await expect(stop({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});

	it("daemon not running with monitor plugin — killPM2 is called, handleFatalError is not", async () => {
		const configWithMonitor = resolveLaunchpadConfig({
			plugins: [{ name: "monitor", setup: vi.fn() }],
		});
		vi.mocked(loadConfigAndEnv).mockReturnValue(
			okAsync({ dir: "/test", config: configWithMonitor }),
		);
		vi.mocked(withDaemon).mockReturnValue(errAsync(new DaemonNotRunningError()));
		vi.mocked(killPM2).mockReturnValue(okAsync(undefined));

		await stop({});

		expect(vi.mocked(killPM2)).toHaveBeenCalled();
		expect(vi.mocked(handleFatalError)).not.toHaveBeenCalled();
	});
});
