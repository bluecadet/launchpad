import { afterEach } from "node:test";
import { createMockSubsystemCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { AppManager } from "../core/app-manager.js";
import { BusManager } from "../core/bus-manager.js";
import { ProcessManager } from "../core/process-manager.js";
import { createLaunchpadMonitor } from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";
import type { MonitorPlugin } from "../monitor-plugin.js";

// Mock process.exit to prevent tests from actually exiting
// @ts-expect-error - mockImplementation returns undefined
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined);

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
		plugins: [mockPlugin],
	},
	cwd?: string,
) {
	const ctx = createMockSubsystemCtx(cwd);
	const monitor = (await createLaunchpadMonitor(config).setup(ctx))._unsafeUnwrap();

	return {
		monitor,
		rootLogger: ctx.logger,
		plugin: config.plugins![0] as MonitorPlugin,
	};
}

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

describe("LaunchpadMonitor", () => {
	describe("connect", () => {
		it("should connect to PM2 and bus", async () => {
			const connectSpy = vi.spyOn(ProcessManager.prototype, "connect");
			const busConnectSpy = vi.spyOn(BusManager.prototype, "connect");

			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.connect" });

			expect(result).toBeOk();

			expect(connectSpy).toHaveBeenCalled();
			expect(busConnectSpy).toHaveBeenCalled();
		});

		it("should run connect hooks in order", async () => {
			const { monitor, plugin } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.connect" });

			expect(plugin.hooks.beforeConnect).toHaveBeenCalled();
			expect(plugin.hooks.afterConnect).toHaveBeenCalled();
		});

		it("should handle existing daemon when deleteExistingBeforeConnect is true", async () => {
			const _isDaemonRunningSpy = vi
				.spyOn(ProcessManager.prototype, "isDaemonRunning")
				.mockImplementationOnce(() => okAsync(true));
			const deleteAllProcessesSpy = vi.spyOn(ProcessManager.prototype, "deleteAllProcesses");

			const { monitor } = await createTestMonitor({
				deleteExistingBeforeConnect: true,
				apps: [
					{
						pm2: {
							name: "test-app",
							script: "test.js",
						},
					},
				],
				plugins: [mockPlugin],
			});

			const result = await monitor.executeCommand({ type: "monitor.connect" });

			expect(result).toBeOk();
			expect(deleteAllProcessesSpy).toHaveBeenCalled();
		});
	});

	describe("disconnect", () => {
		it("should disconnect from PM2 and bus", async () => {
			const _isDaemonRunningSpy = vi
				.spyOn(ProcessManager.prototype, "isDaemonRunning")
				.mockImplementationOnce(() => okAsync(true));
			const disconnectSpy = vi.spyOn(ProcessManager.prototype, "disconnect");
			const busDisconnectSpy = vi.spyOn(BusManager.prototype, "disconnect");

			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.disconnect" });

			expect(result).toBeOk();
			expect(disconnectSpy).toHaveBeenCalled();
			expect(busDisconnectSpy).toHaveBeenCalled();
		});

		it("should run disconnect hooks in order", async () => {
			const { monitor, plugin } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.disconnect" });

			expect(plugin.hooks.beforeDisconnect).toHaveBeenCalled();
			expect(plugin.hooks.afterDisconnect).toHaveBeenCalled();
		});
	});

	describe("start", () => {
		it("should connect if not already connected", async () => {
			const processManagerConnectSpy = vi.spyOn(ProcessManager.prototype, "connect");
			const appManagerStartAppSpy = vi
				.spyOn(AppManager.prototype, "startApp")
				.mockImplementationOnce(() => okAsync({}));

			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.start" });

			expect(result).toBeOk();
			expect(appManagerStartAppSpy).toHaveBeenCalledWith("test-app");
			expect(processManagerConnectSpy).toHaveBeenCalled();
		});

		it("should handle single app name", async () => {
			const appManagerStartAppSpy = vi
				.spyOn(AppManager.prototype, "startApp")
				.mockImplementationOnce(() => okAsync({}));

			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });

			expect(result).toBeOk();
			expect(appManagerStartAppSpy).toHaveBeenCalledWith("test-app");
		});

		it("should run app start hooks in order", async () => {
			const { monitor, plugin } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.start", appNames: "test-app" });

			expect(plugin.hooks.beforeAppStart).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
			});
			expect(plugin.hooks.afterAppStart).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
				process: expect.any(Object),
			});
		});
	});

	describe("stop", () => {
		it("should stop specified apps", async () => {
			const appManagerStopAppSpy = vi
				.spyOn(AppManager.prototype, "stopApp")
				.mockImplementationOnce(() => okAsync({}));

			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });

			expect(result).toBeOk();
			expect(appManagerStopAppSpy).toHaveBeenCalledWith("test-app");
		});

		it("should run app stop hooks in order", async () => {
			const { monitor, plugin } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.stop", appNames: "test-app" });

			expect(plugin.hooks.beforeAppStop).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
			});
			expect(plugin.hooks.afterAppStop).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
			});
		});
	});

	describe("shutdown", () => {
		it("should stop apps and disconnect", async () => {
			const _appManagerStopAppSpy = vi
				.spyOn(AppManager.prototype, "stopApp")
				.mockImplementationOnce(() => okAsync({}));

			const { monitor, rootLogger } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.shutdown" });

			expect(result).toBeOk();
			expect(rootLogger.info).toHaveBeenCalledWith(expect.stringContaining("Monitor exiting"));
			expect(mockExit).toHaveBeenCalled();
		});

		it("should handle custom exit codes", async () => {
			const { monitor } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.shutdown", exitCode: 123 });
			expect(mockExit).toHaveBeenCalledWith(123);
		});

		it("should run shutdown hook before stopping", async () => {
			const { monitor, plugin } = await createTestMonitor();

			const exitCode = 123;
			await monitor.executeCommand({ type: "monitor.shutdown", exitCode: exitCode });

			expect(plugin.hooks.beforeShutdown).toHaveBeenCalledWith(expect.any(Object), {
				code: exitCode,
			});
		});
	});
});
