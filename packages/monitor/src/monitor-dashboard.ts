import { createRequire } from "node:module";
import { Handlebars, loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import { createEventStream } from "h3";
import type { MonitorAppStatus, MonitorState, MonitorStateManager } from "./monitor-state.js";

Handlebars.registerHelper(
	"ifMatch",
	function (this: Handlebars.HelperDelegate, arg1, arg2, options) {
		return arg1 === arg2 ? options.fn(this) : options.inverse(this);
	},
);

Handlebars.registerHelper("appStatusToThemeVar", (status: MonitorAppStatus) => {
	switch (status) {
		case "online":
			return "success";
		case "offline":
			return "neutral";
		case "errored":
			return "danger";
	}
});

const logPanelTemplate = await loadHandlebarsTemplate<MonitorState>(
	import.meta.resolve("../static/monitor-panel.hbs"),
);

export function registerMonitorDashboardFeatures(
	registry: DashboardRegistry,
	stateManager: MonitorStateManager,
	dispatchCommand: (command: AnyCommand) => void,
) {
	registry.api.get("/api/monitor-stream", (event) => {
		const eventStream = createEventStream(event);

		const stateSubscription = stateManager.onPatch((_e) => {
			eventStream.push(logPanelTemplate(stateManager.state).replaceAll("\n", ""));
		});

		eventStream.onClosed(() => {
			// unsubscribe from state updates on event stream close
			stateSubscription();
		});

		dispatchCommand({
			type: "monitor.start",
			appNames: [],
		});

		return eventStream.send();
	});

	registry.api.post("/api/monitor/restart", async (event) => {
		// TODO
	});

	registry.registerCSS(createRequire(import.meta.url).resolve("../static/monitor-panel.css"));

	registry.registerPanel({
		title: "Monitor",
		render: () =>
			`<div hx-ext="sse" sse-connect="/api/monitor-stream" sse-swap="message">${logPanelTemplate(stateManager.state)}</div>`,
	});
}
