import { createRequire } from "node:module";
import { Handlebars, loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import { createEventStream, readValidatedBody } from "h3";
import { okAsync } from "neverthrow";
import { z } from "zod";
import type { MonitorAppStatus, MonitorState, MonitorStateManager } from "./monitor-state.js";

export function registerMonitorDashboardFeatures(
	registry: DashboardRegistry,
	stateManager: MonitorStateManager,
	dispatchCommand: (command: AnyCommand) => void,
) {
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

	return loadHandlebarsTemplate<MonitorState>(
		createRequire(import.meta.url).resolve("../static/monitor-panel.hbs"),
	).andThen((logPanelTemplate) => {
		registry.api.get("/api/monitor-stream", (event) => {
			const eventStream = createEventStream(event);

			const stateSubscription = stateManager.onPatch((_e) => {
				eventStream.push(logPanelTemplate(stateManager.state).replaceAll("\n", ""));
			});

			eventStream.onClosed(() => {
				// unsubscribe from state updates on event stream close
				stateSubscription();
			});

			return eventStream.send();
		});

		registry.api.post("/api/monitor/action", async (event) => {
			const body = await readValidatedBody(
				event,
				z.object({
					action: z.enum(["start", "stop", "restart"]),
					appName: z.string().optional(),
				}),
			);

			switch (body.action) {
				case "start":
					await dispatchCommand({
						type: "monitor.start",
						appNames: body.appName ? [body.appName] : undefined,
					});
					break;
				case "stop":
					await dispatchCommand({
						type: "monitor.stop",
						appNames: body.appName ? [body.appName] : undefined,
					});
					break;
				case "restart":
					await dispatchCommand({
						type: "monitor.restart",
						appNames: body.appName ? [body.appName] : undefined,
					});
					break;
			}
		});

		registry.registerCSS(createRequire(import.meta.url).resolve("../static/monitor-panel.css"));

		registry.registerPanel({
			title: "Monitor",
			render: () =>
				`<div hx-ext="sse" sse-connect="/api/monitor-stream" sse-swap="message">${logPanelTemplate(stateManager.state)}</div>`,
		});

		return okAsync();
	});
}
