import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { createEventStream } from "h3";
import type { ContentState, ContentStateManager } from "./content-state.js";

function renderContentPanel(state: ContentState) {
	return `<pre>${JSON.stringify(state)}</pre>`;
}

export function registerContentDashboardFeatures(
	registry: DashboardRegistry,
	stateManager: ContentStateManager,
) {
	registry.api.get("/api/content-stream", (event) => {
		const eventStream = createEventStream(event);

		const stateSubscription = stateManager.onPatch((_e) => {
			eventStream.push(renderContentPanel(stateManager.state));
		});

		eventStream.onClosed(() => {
			// unsubscribe from state updates on event stream close
			stateSubscription();
		});

		return eventStream.send();
	});

	registry.registerPanel({
		title: "Content State",
		render: () =>
			`<div hx-ext="sse" sse-connect="/api/content-stream" sse-swap="message">${renderContentPanel(stateManager.state)}</div>`,
	});
}
