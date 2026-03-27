import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import {
	createApp,
	createEventStream,
	createRouter,
	defineEventHandler,
	getRouterParam,
	readBody,
	setResponseHeader,
} from "h3";
import type { ResultAsync } from "neverthrow";
import type { ResolvedDashboardConfig } from "../dashboard-config.js";
import type { DashboardPage } from "../dashboard-page.js";
import type { SseManager } from "./sse-manager.js";
import { renderIndexPageBody } from "./templates/index-page.js";
import { renderLayout } from "./templates/layout.js";
import {
	collectAllPanels,
	renderPageBody,
	renderPanelContainer,
} from "./templates/page-template.js";
import { renderPanelFragment } from "./templates/panel-fragment.js";

export type ServerDeps = {
	config: ResolvedDashboardConfig;
	getState: () => VersionedLaunchpadState;
	dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	sseManager: SseManager;
};

/**
 * Build the h3 app with all dashboard routes.
 */
export function createH3App(deps: ServerDeps) {
	const { config, getState, dispatchCommand, sseManager } = deps;
	const { pages, panels: overviewPanels } = config;

	const allPanels = collectAllPanels(pages, overviewPanels);
	const pageMap = new Map<string, DashboardPage>(pages.map((p) => [p.id, p]));

	const app = createApp();
	const router = createRouter();

	// GET / — index page
	router.get(
		"/",
		defineEventHandler((event) => {
			setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
			const state = getState();
			const body = renderIndexPageBody(pages, overviewPanels, state);
			return renderLayout("Overview", body, pages, null);
		}),
	);

	// GET /pages/:id — individual page
	router.get(
		"/pages/:id",
		defineEventHandler((event) => {
			const id = getRouterParam(event, "id") ?? "";
			const page = pageMap.get(id);
			if (!page) {
				setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
				return renderLayout("Not Found", "<p>Page not found.</p>", pages, null);
			}
			setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
			const state = getState();
			const body = renderPageBody(page, state);
			return renderLayout(page.title, body, pages, page.id);
		}),
	);

	// GET /panels/:id — individual panel fragment (htmx on-demand refresh)
	router.get(
		"/panels/:id",
		defineEventHandler((event) => {
			const id = getRouterParam(event, "id") ?? "";
			const panel = allPanels.find((p) => p.id === id);
			if (!panel) {
				event.node.res.statusCode = 404;
				return "Panel not found";
			}
			setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
			const state = getState();
			return renderPanelContainer(panel, state);
		}),
	);

	// GET /sse — SSE stream for live panel updates
	router.get(
		"/sse",
		defineEventHandler(async (event) => {
			const eventStream = createEventStream(event);

			// Send all panels immediately on connect (avoids blank panels on reconnect)
			const state = getState();
			for (const panel of allPanels) {
				await eventStream.push({
					event: panel.id,
					data: renderPanelFragment(panel, state),
				});
			}

			const cleanup = sseManager.addClient(eventStream);
			eventStream.onClosed(() => cleanup());

			return eventStream.send();
		}),
	);

	// POST /commands — dispatch a command
	router.post(
		"/commands",
		defineEventHandler(async (event) => {
			const body = await readBody(event);
			if (!body || typeof body !== "object" || typeof body.type !== "string") {
				event.node.res.statusCode = 400;
				return { error: "Invalid command: body must be a JSON object with a 'type' field" };
			}

			const result = await dispatchCommand(body as BaseCommand);
			if (result.isErr()) {
				event.node.res.statusCode = 500;
				return { error: result.error.message };
			}

			return { ok: true };
		}),
	);

	app.use(router);
	return app;
}

/**
 * Collect all panels referenced across pages and overview panels.
 * Re-exported for use in the plugin.
 */
export { collectAllPanels };
