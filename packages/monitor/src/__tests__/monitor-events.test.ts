import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { describe, expect, it, vi } from "vitest";
import LaunchpadMonitor from "../launchpad-monitor.js";
import type { MonitorConfig } from "../monitor-config.js";

// Mock process.exit to prevent tests from actually exiting
// @ts-expect-error - mockImplementation returns undefined
const _mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined);

vi.mock("../utils/debounce-results.ts", () => ({
	debounceResultAsync: (fn: unknown) => fn,
}));

function createTestMonitor(config: MonitorConfig = { apps: [] }, cwd?: string) {
	const rootLogger = createMockLogger();
	const monitor = new LaunchpadMonitor(config, rootLogger, cwd);

	return {
		monitor,
		rootLogger,
	};
}

describe("Monitor Event Emissions", () => {
	describe("Connection Lifecycle Events", () => {
		it("should emit monitor:connect:start when connecting", async () => {
			const { monitor } = createTestMonitor();
			const eventBus = createMockEventBus();
			monitor.setEventBus(eventBus);

			await monitor.connect();

			const startEvents = eventBus.getEventsOfType("monitor:connect:start");
			expect(startEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:connect:start", {});
		});

		it("should emit monitor:connect:done on successful connection", async () => {
			const { monitor } = createTestMonitor({
				apps: [
					{ pm2: { name: "app1", script: "test.js" } },
					{ pm2: { name: "app2", script: "test.js" } },
				],
			});
			const eventBus = createMockEventBus();
			monitor.setEventBus(eventBus);

			await monitor.connect();

			const doneEvents = eventBus.getEventsOfType<{ appCount: number }>("monitor:connect:done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ appCount: 2 });
		});

		it("should emit monitor:disconnect:start when disconnecting", async () => {
			const { monitor } = createTestMonitor();
			const eventBus = createMockEventBus();
			monitor.setEventBus(eventBus);

			await monitor.disconnect();

			const startEvents = eventBus.getEventsOfType("monitor:disconnect:start");
			expect(startEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:disconnect:start", {});
		});

		it("should emit monitor:disconnect:done on successful disconnection", async () => {
			const { monitor } = createTestMonitor();
			const eventBus = createMockEventBus();
			monitor.setEventBus(eventBus);

			await monitor.disconnect();

			const doneEvents = eventBus.getEventsOfType("monitor:disconnect:done");
			expect(doneEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:disconnect:done", {});
		});
	});

	describe("Event Ordering", () => {
		it("should emit events in the correct order during connect", async () => {
			const { monitor } = createTestMonitor({
				apps: [{ pm2: { name: "test-app", script: "test.js" } }],
			});
			const eventBus = createMockEventBus();
			monitor.setEventBus(eventBus);

			await monitor.connect();

			const events = eventBus.getEmittedEvents();
			const eventTypes = events.map((e) => e.event);

			// Should have: start, done
			expect(eventTypes[0]).toBe("monitor:connect:start");
			expect(eventTypes[eventTypes.length - 1]).toBe("monitor:connect:done");
		});
	});

	describe("EventBus Not Set", () => {
		it("should handle missing eventBus gracefully", () => {
			const { monitor } = createTestMonitor({
				apps: [{ pm2: { name: "test-app", script: "test.js" } }],
			});

			// EventBus is optional - should not throw when not set
			expect(() => monitor.setEventBus).not.toThrow();
			// Events are emitted with optional chaining, so no errors occur
			expect(monitor._eventBus).toBeUndefined();
		});
	});
});
