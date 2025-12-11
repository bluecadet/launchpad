import { createRequire } from "node:module";
import { Handlebars, loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import { createEventStream, readValidatedBody } from "h3";
import { okAsync } from "neverthrow";
import { z } from "zod";
import type { ContentPhase, ContentState, ContentStateManager } from "./content-state.js";

export function registerContentDashboardFeatures(
	registry: DashboardRegistry,
	stateManager: ContentStateManager,
	dispatchCommand: (command: AnyCommand) => void,
) {
	Handlebars.registerHelper("fetchPhaseToThemeVar", (status: ContentPhase["phase"]) => {
		switch (status) {
			case "idle":
				return "neutral";
			case "done":
				return "success";
			case "setup":
			case "backup":
			case "clearing":
			case "fetching":
			case "transforming":
			case "finalizing":
			case "cleanup":
				return "warning";
			case "error":
				return "danger";
		}
	});

	return loadHandlebarsTemplate<ContentState>(
		createRequire(import.meta.url).resolve("../static/content-panel.hbs"),
	).andThen((contentPanelTemplate) => {
		registry.api.get("/api/content-stream", (event) => {
			const eventStream = createEventStream(event);

			const stateSubscription = stateManager.onPatch((_e) => {
				eventStream.push(contentPanelTemplate(stateManager.state).replaceAll("\n", ""));
			});

			eventStream.onClosed(() => {
				// unsubscribe from state updates on event stream close
				stateSubscription();
			});

			return eventStream.send();
		});

		registry.api.post("/api/content/action", async (event) => {
			const body = await readValidatedBody(
				event,
				z.object({
					action: z.enum(["fetch", "clear"]),
					id: z.string().optional(),
				}),
			);

			switch (body.action) {
				case "fetch":
					await dispatchCommand({
						type: "content.fetch",
						sources: body.id ? [body.id] : undefined,
					});
					break;
				case "clear":
					await dispatchCommand({
						type: "content.clear",
						sources: body.id ? [body.id] : undefined,
					});
					break;
			}
		});

		registry.registerPanel({
			title: "Content",
			render: () =>
				`<div hx-ext="sse" sse-connect="/api/content-stream" sse-swap="message">${contentPanelTemplate(stateManager.state)}</div>`,
		});

		registry.registerCSS(createRequire(import.meta.url).resolve("../static/content-panel.css"));

		return okAsync();
	});
}
