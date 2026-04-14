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
vi.mock("../../utils/on-terminate.js", () => ({
	onTerminate: vi.fn(),
}));

import { contentStatusSection } from "@bluecadet/launchpad-content";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { monitorStatusSection } from "@bluecadet/launchpad-monitor";
import { createEmptyState, createMockIPCClient } from "@bluecadet/launchpad-testing/test-utils.ts";
import { statusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { errAsync, okAsync } from "neverthrow";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
import { cliLogger } from "../../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../../utils/command-utils.js";
import { DaemonNotRunningError, withDaemon } from "../../utils/controller-execution.js";
import { onTerminate } from "../../utils/on-terminate.js";
import { status } from "../status.js";

const mockControllerConfig = controllerConfigSchema.parse({});
const mockConfig = resolveLaunchpadConfig({ controller: mockControllerConfig });

describe("status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		statusRegistry.reset();
		statusRegistry.contributeStatusSection(monitorStatusSection);
		statusRegistry.contributeStatusSection(contentStatusSection);
		vi.mocked(loadConfigAndEnv).mockReturnValue(okAsync({ dir: "/test", config: mockConfig }));
		vi.mocked(handleFatalError).mockImplementation(() => {
			throw new Error("fatal");
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("queries state and calls cliLogger.fixed() with output containing 'Launchpad Status:'", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState();
		mockClient.queryState.mockReturnValue(okAsync(state));

		// Return ResultAsync directly (no async wrapper) so .orElse() works
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		const result = await status({});

		expect(result.isOk()).toBe(true);
		expect(vi.mocked(cliLogger.fixed)).toHaveBeenCalledWith(
			expect.stringContaining("Launchpad Status:"),
		);
	});

	it("output includes formatted uptime when state.system.startTime is set", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState({
			system: { mode: "task", startTime: new Date(Date.now() - 65_000), version: "0" },
		});
		mockClient.queryState.mockReturnValue(okAsync(state));

		// Return ResultAsync directly (no async wrapper) so .orElse() works
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await status({});

		const fixedCall = vi.mocked(cliLogger.fixed).mock.calls[0]?.[0];
		expect(typeof fixedCall).toBe("string");
		expect(fixedCall).toContain("Uptime:");
	});

	it("watch mode — calls client.onStateChange()", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState();
		mockClient.queryState.mockReturnValue(okAsync(state));

		// Resolve onTerminate immediately so the neverResolve promise settles
		vi.mocked(onTerminate).mockImplementation((cb) => {
			cb();
			return () => {};
		});

		// Return ResultAsync directly (no async wrapper) so .orElse() works
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		const result = await status({ watch: true });

		expect(result.isOk()).toBe(true);
		expect(vi.mocked(mockClient.onStateChange)).toHaveBeenCalled();
	});

	it("DaemonNotRunningError from withDaemon — handleFatalError is called via orElse", async () => {
		vi.mocked(withDaemon).mockReturnValue(errAsync(new DaemonNotRunningError()));

		await expect(status({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});

	it("queryState fails — handleFatalError called", async () => {
		const mockClient = createMockIPCClient({
			queryState: vi.fn().mockReturnValue(errAsync(new Error("connection lost"))),
		});
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await expect(status({})).rejects.toThrow("fatal");
		expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
	});

	it("watch mode: onStateChange callback fires — fixed called with updated state", async () => {
		const mockClient = createMockIPCClient();
		const initialState = createEmptyState();
		mockClient.queryState.mockReturnValue(okAsync(initialState));

		let stateChangeCb: ((state: typeof initialState) => void) | undefined;
		mockClient.onStateChange.mockImplementation((cb) => {
			stateChangeCb = cb;
			return () => {};
		});

		vi.mocked(onTerminate).mockImplementation((cb) => {
			cb();
			return () => {};
		});

		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await status({ watch: true });

		// Trigger a state change after the initial render
		const updatedState = createEmptyState({
			system: { mode: "task", startTime: new Date(), version: "1" },
		});
		stateChangeCb?.(updatedState);

		// fixed called once for initial render, once for the state change callback
		expect(vi.mocked(cliLogger.fixed)).toHaveBeenCalledTimes(2);
	});

	it("state with monitor plugin — output includes 'Monitor:' section and connection status", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState({
			plugins: {
				monitor: { isConnected: true, isShuttingDown: false, apps: {} },
			},
		});
		mockClient.queryState.mockReturnValue(okAsync(state));
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await status({});

		const output = vi.mocked(cliLogger.fixed).mock.calls[0]?.[0] as string;
		expect(output).toContain("Monitor:");
		expect(output).toContain("Connected:");
	});

	it("state with content plugin in idle phase — output includes 'Content:' and phase", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState({
			plugins: {
				content: { phase: "idle", sources: {} },
			},
		});
		mockClient.queryState.mockReturnValue(okAsync(state));
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await status({});

		const output = vi.mocked(cliLogger.fixed).mock.calls[0]?.[0] as string;
		expect(output).toContain("Content:");
		expect(output).toContain("Phase: idle");
	});

	it("state with content source in error state — output shows error message and restored status", async () => {
		const mockClient = createMockIPCClient();
		const state = createEmptyState({
			plugins: {
				content: {
					phase: "error",
					error: new Error("unknown content error"),
					restored: true,
					sources: {
						"my-source": {
							state: "error",
							error: new Error("fetch timed out"),
							attemptedAt: new Date(),
							restored: true,
						},
					},
				},
			},
		});
		mockClient.queryState.mockReturnValue(okAsync(state));
		vi.mocked(withDaemon).mockImplementation((_dir, _cfg, _relay, op) =>
			op(mockClient as unknown as IPCClient, 999),
		);

		await status({});

		const output = vi.mocked(cliLogger.fixed).mock.calls[0]?.[0] as string;
		expect(output).toContain("my-source");
		expect(output).toContain("fetch timed out");
		expect(output).toContain("restored from backup");
	});
});
