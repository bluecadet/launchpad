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

import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import { deletePidFile, isProcessRunning } from "@bluecadet/launchpad-controller/pid-utils";
import { createMockIPCClient } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
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
			op(mockClient as any, 999),
		);

		const resultPromise = stop({});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.isOk()).toBe(true);
		expect(mockClient.shutdown).toHaveBeenCalled();
		expect(vi.mocked(deletePidFile)).toHaveBeenCalled();
	});

	it("daemon not running (no monitor plugin) — handleFatalError is called", async () => {
		vi.mocked(withDaemon).mockReturnValue(errAsync(new DaemonNotRunningError()) as any);

		await expect(stop({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalledWith(expect.any(DaemonNotRunningError));
	});

	it("loadConfigAndEnv fails — handleFatalError called", async () => {
		vi.mocked(loadConfigAndEnv).mockReturnValue(errAsync(new Error("config load failed")) as any);

		await expect(stop({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});
});
