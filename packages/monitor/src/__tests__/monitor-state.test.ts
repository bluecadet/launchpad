import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import type pm2 from "pm2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppManager } from "../core/app-manager.js";
import { ProcessManager } from "../core/process-manager.js";
import { PM2Error } from "../errors.js";
import { monitor } from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";

// Mock process.exit to prevent tests from actually exiting
// @ts-expect-error - mockImplementation returns undefined
const _mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined);

AppManager.prototype.applyWindowSettings = vi.fn().mockImplementation(() => okAsync({}));

ProcessManager.prototype.connect = vi.fn().mockImplementation(() => okAsync(undefined));
ProcessManager.prototype.disconnect = vi.fn().mockImplementation(() => okAsync(undefined));
ProcessManager.prototype.isDaemonRunning = vi.fn().mockImplementation(() => okAsync(true));
ProcessManager.prototype.deleteProcess = vi.fn();

let processes: pm2.ProcessDescription[] = [];

async function createTestMonitor(
	config: MonitorConfig = {
		apps: [
			{
				pm2: {
					name: "test-app",
					script: "test.js",
				},
			},
		],
	},
	cwd?: string,
) {
	const ctx = createMockPluginCtx(cwd);
	const instance = (await monitor(config).setup(ctx))._unsafeUnwrap();

	return {
		monitor: instance,
		rootLogger: ctx.logger,
	};
}

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

describe("LaunchpadMonitor - State Tracking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		processes = [];

		ProcessManager.prototype.startProcess = vi.fn().mockImplementation((options) => {
			const existingProcess = processes.find((proc) => proc.name === options.name);
			if (existingProcess) {
				return okAsync(existingProcess);
			}

			const newProcess: pm2.ProcessDescription = {
				pm_id: processes.length,
				pm2_env: {
					status: "online",
				} as any,
				pid: 1000 + processes.length,
				name: options.name || `app-${processes.length}`,
			} as pm2.ProcessDescription;

			processes.push(newProcess);
			return okAsync(newProcess);
		});

		ProcessManager.prototype.stopProcess = vi.fn().mockImplementation((appName: string) => {
			const procIndex = processes.findIndex((proc) => proc.name === appName);
			if (procIndex === -1) {
				return okAsync(undefined);
			}

			const [stoppedProcess] = processes.splice(procIndex, 1);
			return okAsync(stoppedProcess);
		});

		ProcessManager.prototype.getProcesses = vi
			.fn()
			.mockImplementation(() => okAsync(processes.slice()));
	});

	describe("start - state updates", () => {
		it("should initialize state with offline state", async () => {
			const { monitor } = await createTestMonitor();

			expect(monitor.getState().apps).toEqual({
				"test-app": {
					status: "offline",
				},
			});
		});

		it("should update state with app status when app starts successfully", async () => {
			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["test-app"]!).toBeDefined();
			expect(state.apps["test-app"]!.status).toBe("online");
			expect(state.apps["test-app"]!.pid).toBe(1000);
			expect(state.apps["test-app"]!.pm2Id).toBe(0);
			expect(state.apps["test-app"]!.lastStart).toBeInstanceOf(Date);
		});

		it("should mark app as errored when start fails", async () => {
			const { monitor } = await createTestMonitor();

			const testError = new PM2Error("Failed to start app");
			vi.mocked(ProcessManager.prototype.startProcess).mockReturnValueOnce(errAsync(testError));

			const result = await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });

			expect(result).toBeErr();

			const state = monitor.getState();
			expect(state.apps["test-app"]!.status).toBe("errored");
			expect(state.apps["test-app"]!.lastError).toBeInstanceOf(Date);
			expect(state.apps["test-app"]!.pid).toBeUndefined();
		});

		it("should track lastStart timestamp within expected range", async () => {
			const { monitor } = await createTestMonitor();

			const beforeStart = new Date();
			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			const afterStart = new Date();

			const lastStart = monitor.getState().apps["test-app"]!.lastStart!;
			expect(lastStart.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
			expect(lastStart.getTime()).toBeLessThanOrEqual(afterStart.getTime());
		});

		it("should handle multiple apps starting", async () => {
			const { monitor } = await createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
				],
			});

			const result = await monitor.executeCommand({ type: "monitor.start" });

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["app-1"]!.status).toBe("online");
			expect(state.apps["app-1"]!.pid).toBe(1000);
			expect(state.apps["app-2"]!.status).toBe("online");
			expect(state.apps["app-2"]!.pid).toBe(1001);
		});
	});

	describe("stop - state updates", () => {
		it("should update state when app stops", async () => {
			const { monitor } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			expect(monitor.getState().apps["test-app"]!.pid).toBe(1000);

			const result = await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });

			expect(result).toBeOk();

			const state = monitor.getState();
			expect(state.apps["test-app"]!.status).toBe("offline");
			expect(state.apps["test-app"]!.pid).toBeUndefined();
			expect(state.apps["test-app"]!.lastStop).toBeInstanceOf(Date);
		});

		it("should track lastStop timestamp within expected range", async () => {
			const { monitor } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });

			const beforeStop = new Date();
			await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });
			const afterStop = new Date();

			const lastStop = monitor.getState().apps["test-app"]!.lastStop!;
			expect(lastStop.getTime()).toBeGreaterThanOrEqual(beforeStop.getTime());
			expect(lastStop.getTime()).toBeLessThanOrEqual(afterStop.getTime());
		});

		it("should handle stopping app that was never started", async () => {
			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });

			expect(result).toBeOk();
		});

		it("should handle multiple apps stopping", async () => {
			const { monitor } = await createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
				],
			});

			await monitor.executeCommand({ type: "monitor.start" });

			const result = await monitor.executeCommand({ type: "monitor.stop" });

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
			const { monitor } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			const lastStartTime = monitor.getState().apps["test-app"]!.lastStart;

			await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });
			const stateAfterStop = monitor.getState();

			expect(stateAfterStop.apps["test-app"]!.lastStart).toEqual(lastStartTime);
			expect(stateAfterStop.apps["test-app"]!.lastStop).toBeInstanceOf(Date);
		});

		it("should update lastStart on restart", async () => {
			const { monitor } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			const firstLastStart = monitor.getState().apps["test-app"]!.lastStart;
			expect(firstLastStart).toBeInstanceOf(Date);

			await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });
			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			const secondLastStart = monitor.getState().apps["test-app"]!.lastStart;

			expect(secondLastStart).toBeInstanceOf(Date);
		});
	});

	describe("error state tracking", () => {
		it("should update error state and track lastError timestamp on start failure", async () => {
			const { monitor } = await createTestMonitor();

			const testError = new PM2Error("Failed to start app");
			vi.mocked(ProcessManager.prototype.startProcess).mockReturnValueOnce(errAsync(testError));

			const beforeError = new Date();
			const result = await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });
			const afterError = new Date();

			expect(result).toBeErr();

			const state = monitor.getState();
			expect(state.apps["test-app"]!.status).toBe("errored");
			expect(state.apps["test-app"]!.pid).toBeUndefined();

			const lastError = state.apps["test-app"]!.lastError!;
			expect(lastError).toBeInstanceOf(Date);
			expect(lastError.getTime()).toBeGreaterThanOrEqual(beforeError.getTime());
			expect(lastError.getTime()).toBeLessThanOrEqual(afterError.getTime());
		});
	});

	describe("getState", () => {
		it("should reflect state shape and all configured apps", async () => {
			const { monitor } = await createTestMonitor({
				apps: [
					{ pm2: { name: "app-1", script: "app1.js" } },
					{ pm2: { name: "app-2", script: "app2.js" } },
					{ pm2: { name: "app-3", script: "app3.js" } },
				],
			});

			await monitor.executeCommand({ type: "monitor.start" });

			const state = monitor.getState();
			expect(state).toHaveProperty("isConnected");
			expect(state).toHaveProperty("isShuttingDown");
			expect(state).toHaveProperty("apps");
			expect(Object.keys(state.apps)).toHaveLength(3);
			expect(state.apps["app-1"]).toBeDefined();
			expect(state.apps["app-2"]).toBeDefined();
			expect(state.apps["app-3"]).toBeDefined();
		});
	});
});
