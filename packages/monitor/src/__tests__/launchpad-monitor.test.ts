import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { AppManager } from "../core/app-manager.js";
import { BusManager } from "../core/bus-manager.js";
import { ProcessManager } from "../core/process-manager.js";
import { monitor } from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";

AppManager.prototype.applyWindowSettings = vi.fn().mockImplementation(() => okAsync({}));

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
		eventBus: ctx.eventBus,
	};
}

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

describe("LaunchpadMonitor", () => {
	it("registers explicit monitor commands in the plugin manifest", () => {
		const plugin = monitor({
			apps: [
				{
					pm2: {
						name: "test-app",
						script: "test.js",
					},
				},
			],
		});

		expect(plugin.manifest?.commands?.map((command) => command.id)).toEqual([
			"monitor.connect",
			"monitor.disconnect",
			"monitor.start",
			"monitor.stop",
			"monitor.restart",
			"monitor.shutdown",
		]);
		expect(plugin.manifest?.lifecycle?.startupCommands).toEqual([
			{ type: "monitor.connect" },
			{ type: "monitor.start" },
		]);
	});

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

		it("should emit connect lifecycle events", async () => {
			const { monitor, eventBus } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.connect" });

			expect(eventBus.getEventsOfType("monitor:connect:start")).toHaveLength(1);
			expect(eventBus.getEventsOfType("monitor:connect:done")).toHaveLength(1);
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

		it("should emit disconnect lifecycle events", async () => {
			const { monitor, eventBus } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.disconnect" });

			expect(eventBus.getEventsOfType("monitor:disconnect:start")).toHaveLength(1);
			expect(eventBus.getEventsOfType("monitor:disconnect:done")).toHaveLength(1);
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
		});

		it("should handle custom exit codes", async () => {
			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({ type: "monitor.shutdown", exitCode: 123 });

			expect(result).toBeOk();
		});

		it("should emit beforeShutdown event", async () => {
			const { monitor, eventBus } = await createTestMonitor();

			await monitor.executeCommand({ type: "monitor.shutdown", exitCode: 123 });

			expect(eventBus.getEventsOfType("monitor:beforeShutdown")).toHaveLength(1);
		});
	});

	describe("runtime validation", () => {
		it("should reject malformed commands", async () => {
			const { monitor } = await createTestMonitor();

			const result = await monitor.executeCommand({
				type: "monitor.start",
				appNames: 123,
			} as unknown as Parameters<typeof monitor.executeCommand>[0]);

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("Invalid command:");
		});
	});
});
