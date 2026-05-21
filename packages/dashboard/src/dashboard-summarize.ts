import type { Row, Section } from "@bluecadet/launchpad-utils/types";
import type { DashboardState } from "./dashboard-state.js";

export function buildDashboardSection(dashboard: DashboardState): Section {
	const rows: Row[] = [
		{
			type: "kv",
			label: "Status",
			value: dashboard.isRunning ? "Running" : "Stopped",
			tone: dashboard.isRunning ? "ok" : "error",
		},
	];

	if (dashboard.isRunning) {
		rows.push({
			type: "kv",
			label: "URL",
			value: `http://${dashboard.host}:${dashboard.port}`,
		});
	}

	return { name: "dashboard", order: 30, title: "Dashboard", rows };
}
