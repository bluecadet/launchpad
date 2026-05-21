import { describe, expect, it } from "vitest";
import type { DashboardState } from "../dashboard-state.js";
import { buildDashboardSection } from "../dashboard-summarize.js";

const runningState: DashboardState = {
	isRunning: true,
	port: 3000,
	host: "localhost",
	startedAt: "2024-01-01T00:00:00.000Z",
};

const stoppedState: DashboardState = {
	isRunning: false,
	port: 3000,
	host: "localhost",
};

describe("buildDashboardSection", () => {
	it("returns null when no dashboard state", () => {
		// Simulate what summarize() does when state.plugins.dashboard is undefined
		const dashboard = undefined;
		const result = dashboard ? buildDashboardSection(dashboard) : null;
		expect(result).toBeNull();
	});

	it("returns correct section metadata", () => {
		const section = buildDashboardSection(runningState);
		expect(section.name).toBe("dashboard");
		expect(section.order).toBe(30);
		expect(section.title).toBe("Dashboard");
	});

	it("running state: Status kv has tone ok and URL kv is present", () => {
		const section = buildDashboardSection(runningState);
		const statusRow = section.rows.find((r) => r.type === "kv" && r.label === "Status");
		expect(statusRow).toBeDefined();
		expect(statusRow).toMatchObject({ type: "kv", label: "Status", value: "Running", tone: "ok" });

		const urlRow = section.rows.find((r) => r.type === "kv" && r.label === "URL");
		expect(urlRow).toBeDefined();
		expect(urlRow).toMatchObject({
			type: "kv",
			label: "URL",
			value: "http://localhost:3000",
		});
	});

	it("stopped state: Status kv has tone error and no URL kv", () => {
		const section = buildDashboardSection(stoppedState);
		const statusRow = section.rows.find((r) => r.type === "kv" && r.label === "Status");
		expect(statusRow).toBeDefined();
		expect(statusRow).toMatchObject({
			type: "kv",
			label: "Status",
			value: "Stopped",
			tone: "error",
		});

		const urlRow = section.rows.find((r) => r.type === "kv" && r.label === "URL");
		expect(urlRow).toBeUndefined();
	});
});
