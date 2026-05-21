import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import type { MonitorState } from "../monitor-state.js";
import { buildMonitorSection } from "../monitor-summarize.js";

function makeState(monitorState?: MonitorState): LaunchpadState {
	return {
		plugins: monitorState ? { monitor: monitorState } : {},
	} as LaunchpadState;
}

function makeMonitorState(overrides?: Partial<MonitorState>): MonitorState {
	return {
		isConnected: false,
		isShuttingDown: false,
		apps: {},
		...overrides,
	};
}

describe("buildMonitorSection", () => {
	it("returns correct section metadata", () => {
		const section = buildMonitorSection(makeMonitorState());
		expect(section.name).toBe("monitor");
		expect(section.order).toBe(10);
		expect(section.title).toBe("Monitor");
	});

	it("returns connected kv row with ok tone when connected", () => {
		const section = buildMonitorSection(makeMonitorState({ isConnected: true }));
		const connectedRow = section.rows.find((r) => r.type === "kv" && r.label === "Connected");
		expect(connectedRow).toBeDefined();
		expect(connectedRow).toMatchObject({
			type: "kv",
			label: "Connected",
			value: "Yes",
			tone: "ok",
		});
	});

	it("returns connected kv row with error tone when not connected", () => {
		const section = buildMonitorSection(makeMonitorState({ isConnected: false }));
		const connectedRow = section.rows.find((r) => r.type === "kv" && r.label === "Connected");
		expect(connectedRow).toMatchObject({
			type: "kv",
			label: "Connected",
			value: "No",
			tone: "error",
		});
	});

	it("omits apps list row when apps map is empty", () => {
		const section = buildMonitorSection(makeMonitorState({ apps: {} }));
		const appsRow = section.rows.find((r) => r.type === "list");
		expect(appsRow).toBeUndefined();
	});

	it("includes apps list row with correct entries when apps are present", () => {
		const section = buildMonitorSection(
			makeMonitorState({
				apps: {
					myApp: { status: "online", pid: 1234 },
					otherApp: { status: "offline" },
				},
			}),
		);

		const appsRow = section.rows.find((r) => r.type === "list" && r.label === "Apps");
		expect(appsRow).toBeDefined();
		if (appsRow?.type !== "list") throw new Error("Expected list row");

		const onlineItem = appsRow.items.find((r) => r.type === "kv" && r.label === "myApp");
		expect(onlineItem).toMatchObject({
			type: "kv",
			label: "myApp",
			value: "online (PID: 1234)",
			tone: "ok",
		});

		const offlineItem = appsRow.items.find((r) => r.type === "kv" && r.label === "otherApp");
		expect(offlineItem).toMatchObject({
			type: "kv",
			label: "otherApp",
			value: "offline",
			tone: "error",
		});
	});

	it("omits PID suffix when app is online but pid is absent", () => {
		const section = buildMonitorSection(
			makeMonitorState({
				apps: { myApp: { status: "online" } },
			}),
		);

		const appsRow = section.rows.find((r) => r.type === "list" && r.label === "Apps");
		if (appsRow?.type !== "list") throw new Error("Expected list row");

		const onlineItem = appsRow.items.find((r) => r.type === "kv" && r.label === "myApp");
		expect(onlineItem).toMatchObject({ value: "online", tone: "ok" });
	});

	it("shows errored status with error tone", () => {
		const section = buildMonitorSection(
			makeMonitorState({
				apps: { crashApp: { status: "errored" } },
			}),
		);

		const appsRow = section.rows.find((r) => r.type === "list" && r.label === "Apps");
		if (appsRow?.type !== "list") throw new Error("Expected list row");

		const erroredItem = appsRow.items.find((r) => r.type === "kv" && r.label === "crashApp");
		expect(erroredItem).toMatchObject({ value: "errored", tone: "error" });
	});
});

describe("monitor plugin summarize", () => {
	it("returns null when monitor state is absent", async () => {
		const { monitor } = await import("../launchpad-monitor.js");
		const plugin = monitor({ apps: [] });
		const state = makeState();
		expect(plugin.summarize?.(state)).toBeNull();
	});
});
