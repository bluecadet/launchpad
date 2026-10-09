import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import { monitor } from "../launchpad-monitor.js";
import { projectMonitorMetrics } from "../monitor-metrics.js";
import type { MonitorState } from "../monitor-state.js";

function launchpadState(monitorState?: MonitorState): LaunchpadState {
	return {
		system: { startTime: new Date(0), mode: "persistent" },
		plugins: monitorState ? { monitor: monitorState } : {},
	};
}

describe("monitor metric observations", () => {
	it("returns no observations when monitor state is missing or null", () => {
		const plugin = monitor({ apps: [] });

		expect(plugin.observe?.(launchpadState())).toEqual([]);
		expect(projectMonitorMetrics(null, new Set())).toEqual([]);
	});

	it("projects connection and configured app observed status as one-hot gauges", async () => {
		const plugin = monitor({
			apps: [{ pm2: { name: "display", script: "display.js" } }],
		});
		expect(await plugin.setup(createMockPluginCtx())).toBeOk();

		const observations =
			plugin.observe?.(
				launchpadState({
					isConnected: true,
					isShuttingDown: false,
					apps: {
						display: { status: "errored", pid: 1234 },
						unconfigured: { status: "online", pid: 5678 },
					},
				}),
			) ?? [];

		expect(observations).toEqual([
			expect.objectContaining({ name: "launchpad_monitor_connected", value: 1 }),
			expect.objectContaining({
				name: "launchpad_monitor_app_status",
				value: 0,
				attributes: { app: "display", status: "online" },
			}),
			expect.objectContaining({
				name: "launchpad_monitor_app_status",
				value: 0,
				attributes: { app: "display", status: "offline" },
			}),
			expect.objectContaining({
				name: "launchpad_monitor_app_status",
				value: 1,
				attributes: { app: "display", status: "errored" },
			}),
		]);
		expect(observations.some((observation) => observation.attributes?.app === "unconfigured")).toBe(
			false,
		);
		expect(observations.some((observation) => "pid" in (observation.attributes ?? {}))).toBe(false);
	});

	it("reports a disconnected monitor as zero without inventing app data", () => {
		const observations = projectMonitorMetrics(
			{ isConnected: false, isShuttingDown: false, apps: {} },
			new Set(["display"]),
		);

		expect(observations).toEqual([
			expect.objectContaining({ name: "launchpad_monitor_connected", value: 0 }),
		]);
	});
});
