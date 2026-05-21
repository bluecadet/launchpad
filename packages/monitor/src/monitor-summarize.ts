import type { Row, Section } from "@bluecadet/launchpad-utils/types";
import type { MonitorState } from "./monitor-state.js";

export function buildMonitorSection(monitorState: MonitorState): Section {
	const rows: Row[] = [
		{
			type: "kv",
			label: "Connected",
			value: monitorState.isConnected ? "Yes" : "No",
			tone: monitorState.isConnected ? "ok" : "error",
		},
	];

	if (monitorState.apps && Object.keys(monitorState.apps).length > 0) {
		const items: Row[] = Object.entries(monitorState.apps).map(([appName, appState]) => {
			const value =
				appState.status === "online"
					? appState.pid !== undefined
						? `online (PID: ${appState.pid})`
						: "online"
					: appState.status;

			return {
				type: "kv",
				label: appName,
				value,
				tone: appState.status === "online" ? "ok" : "error",
			};
		});

		rows.push({ type: "list", label: "Apps", items });
	}

	return { name: "monitor", order: 10, title: "Monitor", rows };
}
