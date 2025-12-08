import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { createEventStream } from "h3";
import type { MonitorState, MonitorStateManager } from "./monitor-state.js";

function renderMonitorPanel(state: MonitorState) {
	return `<pre>${JSON.stringify(state)}</pre>`;
}

export function registerMonitorDashboardFeatures(
	registry: DashboardRegistry,
	stateManager: MonitorStateManager,
) {
	registry.api.get("/api/monitor-stream", (event) => {
		const eventStream = createEventStream(event);

		const stateSubscription = stateManager.onPatch((_e) => {
			eventStream.push(renderMonitorPanel(stateManager.state));
		});

		eventStream.onClosed(() => {
			// unsubscribe from state updates on event stream close
			stateSubscription();
		});

		return eventStream.send();
	});

	registry.registerPanel({
		title: "Monitor State",
		render: () =>
			`<div hx-ext="sse" sse-connect="/api/monitor-stream" sse-swap="message">${renderMonitorPanel(stateManager.state)}</div>`,
	});
}
