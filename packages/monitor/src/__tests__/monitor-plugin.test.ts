import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { PluginDriver } from "@bluecadet/launchpad-utils/plugin-driver";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MonitorPlugin, MonitorPluginDriver } from "../monitor-plugin.js";

describe("MonitorPluginDriver", () => {
	let monitorPluginDriver: MonitorPluginDriver;
	let mockLogger: Logger;
	let mockPlugin: MonitorPlugin;
	let busManager: {
		addEventHandler: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockPlugin = {
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
		};

		busManager = {
			addEventHandler: vi.fn(),
		};

		const eventBus = createMockEventBus();

		const basePluginDriver = new PluginDriver(
			{ logger: mockLogger, abortSignal: new AbortController().signal, eventBus: eventBus },
			[mockPlugin],
		);
		monitorPluginDriver = new MonitorPluginDriver(basePluginDriver, {
			busManager: busManager as any,
		});
	});

	describe("constructor", () => {
		it("should register bus event handler", () => {
			expect(busManager.addEventHandler).toHaveBeenCalledWith(expect.any(Function));
		});
	});

	describe("_handleBusEvent", () => {
		it("should handle process error events", () => {
			monitorPluginDriver._handleBusEvent("process:event", {
				process: { name: "test-app" },
				event: "error",
				data: "test error",
			});

			expect(mockPlugin.hooks.onAppError).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
				error: expect.any(Error),
			});
		});

		it("should handle stdout log events", () => {
			monitorPluginDriver._handleBusEvent("log:out", {
				process: { name: "test-app" },
				data: "test log",
			});

			expect(mockPlugin.hooks.onAppLog).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
				data: "test log",
			});
		});

		it("should handle stderr log events", () => {
			monitorPluginDriver._handleBusEvent("log:err", {
				process: { name: "test-app" },
				data: "test error log",
			});

			expect(mockPlugin.hooks.onAppErrorLog).toHaveBeenCalledWith(expect.any(Object), {
				appName: "test-app",
				data: "test error log",
			});
		});

		it("should ignore events without process name", () => {
			monitorPluginDriver._handleBusEvent("log:out", {
				data: "test log",
			});

			expect(mockPlugin.hooks.onAppLog).not.toHaveBeenCalled();
		});
	});
});
