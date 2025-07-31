import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { AppManager } from "../core/app-manager.js";
import type { MonitorPlugin } from "../core/monitor-plugin-driver.js";
import LaunchpadMonitor from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";

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

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

describe("LaunchpadMonitor", () => {
	describe("connect", () => {
		it("should connect to PM2 and bus", async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._processManager, "connect");
			vi.spyOn(monitor._busManager, "connect");

			const result = await monitor.connect();

			expect(result).toBeOk();

			expect(monitor._processManager.connect).toHaveBeenCalled();
			expect(monitor._busManager.connect).toHaveBeenCalled();
		});

		it("should run connect hooks in order", async () => {
			const { monitor, plugin } = createTestMonitor();

			await monitor.connect();

			expect(plugin.hooks.beforeConnect).toHaveBeenCalled();
			expect(plugin.hooks.afterConnect).toHaveBeenCalled();
		});

		it("should handle existing daemon when deleteExistingBeforeConnect is true", async () => {
			const { monitor } = createTestMonitor();

			monitor._config.deleteExistingBeforeConnect = true;
			monitor._processManager.isDaemonRunning = vi.fn().mockImplementationOnce(() => okAsync(true));
			const killSpy = vi.spyOn(LaunchpadMonitor, "kill");
			vi.spyOn(monitor._processManager, "deleteAllProcesses");

			const result = await monitor.connect();

			expect(result).toBeOk();
			expect(monitor._processManager.deleteAllProcesses).toHaveBeenCalled();
			expect(killSpy).toHaveBeenCalled();
		});
	});

	describe("disconnect", () => {
		it("should disconnect from PM2 and bus", async () => {
			const { monitor } = createTestMonitor();

			monitor._processManager.isDaemonRunning = vi.fn().mockImplementationOnce(() => okAsync(true));
			vi.spyOn(monitor._processManager, "disconnect");
			vi.spyOn(monitor._busManager, "disconnect");

			const result = await monitor.disconnect();

			expect(result).toBeOk();
			expect(monitor._busManager.disconnect).toHaveBeenCalled();
			expect(monitor._processManager.disconnect).toHaveBeenCalled();
		});

		it("should run disconnect hooks in order", async () => {
			const { monitor, plugin } = createTestMonitor();

			await monitor.disconnect();

			expect(plugin.hooks.beforeDisconnect).toHaveBeenCalled();
			expect(plugin.hooks.afterDisconnect).toHaveBeenCalled();
		});
	});

	describe("start", () => {
		it("should connect if not already connected", async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._processManager, "connect");
			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start();

			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith("test-app");
			expect(monitor._processManager.connect).toHaveBeenCalled();
		});

		it("should handle null app names", async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start(null);

			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith("test-app");
		});

		it("should handle single app name", async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._appManager, "startApp").mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start("test-app");

			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith("test-app");
		});

		it("should run app start hooks in order", async () => {
			const { monitor, plugin } = createTestMonitor();

			await monitor.start("test-app");

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
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() => okAsync({}));

			const result = await monitor.stop("test-app");

			expect(result).toBeOk();
			expect(monitor._appManager.stopApp).toHaveBeenCalledWith("test-app");
		});

		it("should run app stop hooks in order", async () => {
			const { monitor, plugin } = createTestMonitor();

			await monitor.stop("test-app");

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
			const { monitor, monitorLogger } = createTestMonitor();

			vi.spyOn(monitor._appManager, "stopApp").mockImplementationOnce(() => okAsync({}));

			const result = await monitor.shutdown();

			expect(result).toBeOk();
			expect(monitorLogger.info).toHaveBeenCalledWith(expect.stringContaining("Monitor exiting"));
			expect(mockExit).toHaveBeenCalled();
		});

		it("should prevent multiple shutdowns", async () => {
			const { monitor, monitorLogger } = createTestMonitor();

			monitor._isShuttingDown = true;

			const result = await monitor.shutdown();

			expect(result).toBeOk();
			expect(monitorLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Aborting exit"));
		});

		it("should handle custom exit codes", async () => {
			const { monitor } = createTestMonitor();

			await monitor.shutdown(123);
			expect(mockExit).toHaveBeenCalledWith(123);
		});

		it("should run shutdown hook before stopping", async () => {
			const { monitor, plugin } = createTestMonitor();

			const exitCode = 123;
			await monitor.shutdown(exitCode);

			expect(plugin.hooks.beforeShutdown).toHaveBeenCalledWith(expect.any(Object), {
				code: exitCode,
			});
		});
	});

	describe("cwd handling", () => {
		it("should use provided cwd for app paths", () => {
			const cwd = "/test/cwd";
			const { monitor } = createTestMonitor(
				{
					apps: [{ pm2: { name: "test-app", script: "test.js", cwd: "app/cwd" } }],
					plugins: [mockPlugin],
				},
				cwd,
			);

			expect(monitor._cwd).toBe(cwd);
			expect(monitor._appManager.getAppOptions("test-app")._unsafeUnwrap().pm2.cwd).toMatch(
				"/test/cwd/app/cwd",
			);
		});

		it("should default to process.cwd() if no cwd is provided", () => {
			const { monitor } = createTestMonitor({
				apps: [{ pm2: { name: "test-app", script: "test.js", cwd: "app/cwd" } }],
				plugins: [mockPlugin],
			});

			expect(monitor._cwd).toBe(process.cwd());
			expect(monitor._appManager.getAppOptions("test-app")._unsafeUnwrap().pm2.cwd).toMatch(
				"/app/cwd",
			);
		});
	});
});
