import {
	createMockEventBus,
	createMockLogger,
	createMockSubsystemCtx,
	type MockEventBus,
} from "@bluecadet/launchpad-testing/test-utils.ts";
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
	const ctx = createMockSubsystemCtx(cwd);
	const monitor = new LaunchpadMonitor(config, ctx);

	return {
		monitor,
		rootLogger: ctx.logger,
		eventBus: ctx.eventBus as MockEventBus,
	};
}

describe("Monitor Event Emissions", () => {
	describe("Connection Lifecycle Events", () => {
		it("should emit monitor:connect:start when connecting", async () => {
			const { monitor, eventBus } = createTestMonitor();

			await monitor.connect();

			const startEvents = eventBus.getEventsOfType("monitor:connect:start");
			expect(startEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:connect:start", {});
		});

		it("should emit monitor:connect:done on successful connection", async () => {
			const { monitor, eventBus } = createTestMonitor({
				apps: [
					{ pm2: { name: "app1", script: "test.js" } },
					{ pm2: { name: "app2", script: "test.js" } },
				],
			});

			await monitor.connect();

			const doneEvents = eventBus.getEventsOfType<{ appCount: number }>("monitor:connect:done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ appCount: 2 });
		});

		it("should emit monitor:disconnect:start when disconnecting", async () => {
			const { monitor, eventBus } = createTestMonitor();

			await monitor.disconnect();

			const startEvents = eventBus.getEventsOfType("monitor:disconnect:start");
			expect(startEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:disconnect:start", {});
		});

		it("should emit monitor:disconnect:done on successful disconnection", async () => {
			const { monitor, eventBus } = createTestMonitor();

			await monitor.disconnect();

			const doneEvents = eventBus.getEventsOfType("monitor:disconnect:done");
			expect(doneEvents).toHaveLength(1);
			expect(eventBus.emit).toHaveBeenCalledWith("monitor:disconnect:done", {});
		});
	});

	describe("Event Ordering", () => {
		it("should emit events in the correct order during connect", async () => {
			const { monitor, eventBus } = createTestMonitor({
				apps: [{ pm2: { name: "test-app", script: "test.js" } }],
			});

			await monitor.connect();

			const events = eventBus.getEmittedEvents();
			const eventTypes = events.map((e) => e.event);

			// Should have: start, done
			expect(eventTypes[0]).toBe("monitor:connect:start");
			expect(eventTypes[eventTypes.length - 1]).toBe("monitor:connect:done");
		});
	});
});
