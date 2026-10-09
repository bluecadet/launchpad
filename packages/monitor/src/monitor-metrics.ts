import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { MonitorAppStatus, MonitorState } from "./monitor-state.js";

const APP_STATUSES: readonly MonitorAppStatus[] = ["online", "offline", "errored"];

/** Projects safe gauge observations from the monitor plugin's current state. */
export function projectMonitorMetrics(
	state: MonitorState | null | undefined,
	configuredAppNames: ReadonlySet<string>,
): readonly MetricObservation[] {
	if (!state) return [];

	const observations: MetricObservation[] = [
		{
			name: "launchpad_monitor_connected",
			value: state.isConnected ? 1 : 0,
			description: "Whether the monitor is currently connected to the process manager.",
		},
	];

	for (const app of configuredAppNames) {
		const appState = state.apps[app];
		if (!appState) continue;

		for (const status of APP_STATUSES) {
			observations.push({
				name: "launchpad_monitor_app_status",
				value: appState.status === status ? 1 : 0,
				description: "Whether the monitored app is currently in the named observed status.",
				attributes: { app, status },
			});
		}
	}

	return observations;
}
