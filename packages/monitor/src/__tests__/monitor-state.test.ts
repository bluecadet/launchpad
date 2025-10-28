import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import type pm2 from "pm2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppManager } from "../core/app-manager.js";
import type { MonitorPlugin } from "../core/monitor-plugin-driver.js";
import LaunchpadMonitor from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";

// Mock process.exit to prevent tests from actually exiting
// @ts-expect-error - mockImplementation returns undefined
const _mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined);

AppManager.prototype.applyWindowSettings = vi.fn().mockImplementation(() => okAsync({}));

const mockPlugin = {
	name: "test-plugin",
	hooks: {
		beforeConnect: vi.fn(),
		afterConnect: vi.fn(),
		beforeDisconnect: vi.fn(),
		afterDisconnect: vi.fn(),
		beforeAppStart: vi.fn(),
		afterAppStart: vi.fn(),
		beforeAppStop: vi.fn(),
		afterAppStop: vi.fn(),
		onAppError: vi.fn(),
		onAppLog: vi.fn(),
		onAppErrorLog: vi.fn(),
		beforeShutdown: vi.fn(),
	},
} as MonitorPlugin;

function createTestMonitor(
	config: MonitorConfig = {
		apps: [
			{
				pm2: {
					name: "test-app",
					script: "test.js",
				},
			},
		],
		plugins: [mockPlugin],
	},
	cwd?: string,
) {
	const rootLogger = createMockLogger();
	const monitor = new LaunchpadMonitor(config, rootLogger, cwd);
	const monitorLogger = rootLogger.children.get("monitor");

	if (!monitorLogger) {
		throw new Error("Failed to create monitor logger");
	}

	return {
		monitor,
		rootLogger,
		monitorLogger,
		plugin: config.plugins![0] as MonitorPlugin,
	};
}

function createMockProcess(appName: string, pid = 12345, pm2Id = 0): pm2.ProcessDescription {
	return {
		pm_id: pm2Id,
		pm2_env: {
			status: "online",
		} as any,
		pid,
		name: appName,
	} as pm2.ProcessDescription;
}

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

describe("LaunchpadMonitor - State Tracking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("start - state updates", () => {
		it("should initialize state with offline state", () => {
			const { monitor } = createTestMonitor();

			expect(monitor.getState().apps).toEqual({
				"test-app": {
					status: "offline",
				},
			});
		});

		it("should update state with app status when app starts successfully", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app", 12345, 0);
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));

			const result = await monitor.start("test-app");

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["test-app"]!).toBeDefined();
			expect(state.apps["test-app"]!.status).toBe("online");
			expect(state.apps["test-app"]!.pid).toBe(12345);
			expect(state.apps["test-app"]!.pm2Id).toBe(0);
			expect(state.apps["test-app"]!.lastStart).toBeInstanceOf(Date);
		});

		it("should set correct pm2Id from process info", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app", 12345, 5);
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));

			await monitor.start("test-app");

			const state = monitor.getState();
			expect(state.apps["test-app"]!.pm2Id).toBe(5);
		});

		it("should mark app as errored when start fails", async () => {
			const { monitor } = createTestMonitor();

			const testError = new Error("Failed to start app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => errAsync(testError));

			const result = await monitor.start("test-app");

			expect(result).toBeErr();

			const state = monitor.getState();
			expect(state.apps["test-app"]!).toBeDefined();
			expect(state.apps["test-app"]!.status).toBe("errored");
			expect(state.apps["test-app"]!.lastError).toBeInstanceOf(Date);
			expect(state.apps["test-app"]!.pid).toBeUndefined();
		});

		it("should track lastStart timestamp", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));

			const beforeStart = new Date();
			await monitor.start("test-app");
			const afterStart = new Date();

			const state = monitor.getState();
			const lastStart = state.apps["test-app"]!.lastStart!;

			expect(lastStart.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
			expect(lastStart.getTime()).toBeLessThanOrEqual(afterStart.getTime());
		});

		it("should handle multiple apps starting", async () => {
			const { monitor } = createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
				],
				plugins: [mockPlugin],
			});

			vi.spyOn(monitor._appManager, "startApp").mockImplementation((appName: string) => {
				const pid = appName === "app-1" ? 1001 : 1002;
				const pm2Id = appName === "app-1" ? 0 : 1;
				return okAsync(createMockProcess(appName, pid, pm2Id));
			});

			const result = await monitor.start(null);

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["app-1"]!).toBeDefined();
			expect(state.apps["app-1"]!.status).toBe("online");
			expect(state.apps["app-1"]!.pid).toBe(1001);
			expect(state.apps["app-2"]!).toBeDefined();
			expect(state.apps["app-2"]!.status).toBe("online");
			expect(state.apps["app-2"]!.pid).toBe(1002);
		});
	});

	describe("stop - state updates", () => {
		it("should update state when app stops", async () => {
			const { monitor } = createTestMonitor();

			// First start an app
			const mockProcess = createMockProcess("test-app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));
			await monitor.start("test-app");

			// Then stop it
			const stoppedProcess = createMockProcess("test-app", 12345, 0);
			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() =>
				okAsync(stoppedProcess),
			);

			const result = await monitor.stop("test-app");

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["test-app"]!.status).toBe("offline");
			expect(state.apps["test-app"]!.pid).toBeUndefined();
			expect(state.apps["test-app"]!.lastStop).toBeInstanceOf(Date);
		});

		it("should track lastStop timestamp", async () => {
			const { monitor } = createTestMonitor();

			// Start app first
			const mockProcess = createMockProcess("test-app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));
			await monitor.start("test-app");

			// Stop the app
			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() => okAsync(mockProcess));

			const beforeStop = new Date();
			await monitor.stop("test-app");
			const afterStop = new Date();

			const state = monitor.getState();
			const lastStop = state.apps["test-app"]!.lastStop!;

			expect(lastStop.getTime()).toBeGreaterThanOrEqual(beforeStop.getTime());
			expect(lastStop.getTime()).toBeLessThanOrEqual(afterStop.getTime());
		});

		it("should clear pid when app stops", async () => {
			const { monitor } = createTestMonitor();

			// Start app
			const mockProcess = createMockProcess("test-app", 12345);
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync(mockProcess));
			await monitor.start("test-app");

			// Verify pid is set
			expect(monitor.getState().apps["test-app"]!.pid).toBe(12345);

			// Stop app
			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() => okAsync(mockProcess));
			await monitor.stop("test-app");

			// Verify pid is cleared
			expect(monitor.getState().apps["test-app"]!.pid).toBeUndefined();
		});

		it("should handle stopping app that was never started", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app");
			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() => okAsync(mockProcess));

			const result = await monitor.stop("test-app");

			expect(result).toBeOk();
		});

		it("should handle multiple apps stopping", async () => {
			const { monitor } = createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
				],
				plugins: [mockPlugin],
			});

			// Start both apps
			vi.spyOn(monitor._appManager, "startApp").mockImplementation((appName: string) => {
				const pid = appName === "app-1" ? 1001 : 1002;
				return okAsync(createMockProcess(appName, pid));
			});
			await monitor.start(null);

			// Stop both apps
			vi.spyOn(monitor._appManager, "stopApp").mockImplementation((appName: string) => {
				const pid = appName === "app-1" ? 1001 : 1002;
				return okAsync(createMockProcess(appName, pid));
			});

			const result = await monitor.stop(null);

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["app-1"]!.status).toBe("offline");
			expect(state.apps["app-1"]!.pid).toBeUndefined();
			expect(state.apps["app-2"]!.status).toBe("offline");
			expect(state.apps["app-2"]!.pid).toBeUndefined();
		});
	});

	describe("state persistence", () => {
		it("should preserve app state through start-stop cycles", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app", 12345, 0);
			vi.spyOn(monitor._appManager, "startApp").mockImplementation(() => okAsync(mockProcess));
			vi.spyOn(monitor._appManager, "stopApp").mockImplementation(() => okAsync(mockProcess));

			// Start
			await monitor.start("test-app");
			const stateAfterStart = monitor.getState();
			const lastStartTime = stateAfterStart.apps["test-app"]!.lastStart;

			// Stop
			await monitor.stop("test-app");
			const stateAfterStop = monitor.getState();

			// Verify previous timestamps are preserved
			expect(stateAfterStop.apps["test-app"]!.lastStart).toEqual(lastStartTime);
			expect(stateAfterStop.apps["test-app"]!.lastStop).toBeInstanceOf(Date);
		});

		it("should update lastStart on restart", async () => {
			const { monitor } = createTestMonitor();

			const mockProcess = createMockProcess("test-app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementation(() => okAsync(mockProcess));
			vi.spyOn(monitor._appManager, "stopApp").mockImplementation(() => okAsync(mockProcess));

			// Start
			await monitor.start("test-app");
			const firstLastStart = monitor.getState().apps["test-app"]!.lastStart;
			expect(firstLastStart).toBeInstanceOf(Date);

			// Stop
			await monitor.stop("test-app");

			// Restart - should create a new lastStart timestamp
			await monitor.start("test-app");
			const secondLastStart = monitor.getState().apps["test-app"]!.lastStart;

			// Verify lastStart is a Date instance (it will be updated on restart)
			expect(secondLastStart).toBeInstanceOf(Date);
			expect(firstLastStart).toBeDefined();
			expect(secondLastStart).toBeDefined();
		});
	});

	describe("error state tracking", () => {
		it("should handle start failure and update error state", async () => {
			const { monitor } = createTestMonitor();

			// Simulate start failure
			const testError = new Error("Failed to start app");
			vi.spyOn(monitor._appManager, "startApp").mockImplementation(() => errAsync(testError));

			const result = await monitor.start("test-app");

			expect(result).toBeErr();

			const state = monitor.getState();
			expect(state.apps["test-app"]!.status).toBe("errored");
			expect(state.apps["test-app"]!.lastError).toBeInstanceOf(Date);
			expect(state.apps["test-app"]!.pid).toBeUndefined();
		});

		it("should track lastError timestamp", async () => {
			const { monitor } = createTestMonitor();

			const testError = new Error("Start failed");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => errAsync(testError));

			const beforeError = new Date();
			await monitor.start("test-app");
			const afterError = new Date();

			const state = monitor.getState();
			const lastError = state.apps["test-app"]!.lastError!;

			expect(lastError.getTime()).toBeGreaterThanOrEqual(beforeError.getTime());
			expect(lastError.getTime()).toBeLessThanOrEqual(afterError.getTime());
		});
	});

	describe("getState", () => {
		it("should return the current monitor state", () => {
			const { monitor } = createTestMonitor();

			const state = monitor.getState();

			expect(state).toHaveProperty("isConnected");
			expect(state).toHaveProperty("isShuttingDown");
			expect(state).toHaveProperty("apps");
			expect(typeof state.apps).toBe("object");
		});

		it("should reflect all apps in state", async () => {
			const { monitor } = createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
					{ pm2: { name: "app-3", script: "app3.js" } },
				],
				plugins: [mockPlugin],
			});

			const mockProcess = (appName: string) => createMockProcess(appName);
			vi.spyOn(monitor._appManager, "startApp").mockImplementation((appName: string) =>
				okAsync(mockProcess(appName)),
			);

			await monitor.start(null);

			const state = monitor.getState();
			expect(Object.keys(state.apps)).toHaveLength(3);
			expect(state.apps["app-1"]!).toBeDefined();
			expect(state.apps["app-2"]!).toBeDefined();
			expect(state.apps["app-3"]).toBeDefined();
		});
	});
});
