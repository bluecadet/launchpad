import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { registry } from "@bluecadet/launchpad-utils/panel-registry";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import {
	createApp,
	createEventStream,
	createRouter,
	defineEventHandler,
	getRouterParam,
	readBody,
	serveStatic,
	setResponseHeader,
} from "h3";
import type { ResultAsync } from "neverthrow";
import type { DashboardPage } from "../dashboard-page.js";
import type { DashboardPanel } from "../dashboard-panel.js";
import type { SseManager } from "./sse-manager.js";
import { renderIndexPageBody } from "./templates/index-page.js";
import { renderLayout } from "./templates/layout.js";
import { renderPageBody, renderPanelContainer } from "./templates/page-template.js";
import { renderPanelFragment } from "./templates/panel-fragment.js";

export type ServerDeps = {
	getPanels: () => DashboardPanel[];
	getPages: () => DashboardPage[];
	getState: () => VersionedLaunchpadState;
	dispatchCommand: (command: BaseCommand) => ResultAsync<unknown, Error>;
	sseManager: SseManager;
};

/**
 * Build the h3 app with all dashboard routes.
 */
export function createH3App(deps: ServerDeps) {
	const { getPanels, getPages, getState, dispatchCommand, sseManager } = deps;

	const app = createApp();
	const router = createRouter();

	// GET /assets/** — contributed scripts and styles served via h3 serveStatic
	router.get(
		"/assets/**",
		defineEventHandler((event) => {
			return serveStatic(event, {
				getMeta: async (id) => {
					const script = registry.getScripts().find((s) => s.url === id);
					if (script) {
						const s = await stat(script.filePath).catch(() => null);
						if (s)
							return {
								type: "application/javascript; charset=utf-8",
								size: s.size,
								mtime: s.mtimeMs,
							};
					}
					const style = registry.getStyles().find((s) => s.url === id);
					if (style) {
						const s = await stat(style.filePath).catch(() => null);
						if (s) return { type: "text/css; charset=utf-8", size: s.size, mtime: s.mtimeMs };
					}
					return undefined;
				},
				getContents: (id) => {
					const script = registry.getScripts().find((s) => s.url === id);
					if (script) return createReadStream(script.filePath);
					const style = registry.getStyles().find((s) => s.url === id);
					if (style) return createReadStream(style.filePath);
					return undefined;
				},
			});
		}),
	);

	// GET / — index page
	router.get(
		"/",
		defineEventHandler((event) => {
			const pages = getPages();
			const allPanels = getPanels();
			setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
			const state = getState();
			const body = renderIndexPageBody(pages, allPanels, state);
			return renderLayout("Overview", body, pages, null);
		}),
	);

	// GET /pages/:id — individual page
	router.get(
		"/pages/:id",
		defineEventHandler((event) => {
			const pages = getPages();
			const id = getRouterParam(event, "id") ?? "";
			const pageMap = new Map<string, DashboardPage>(pages.map((p) => [p.id, p]));
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
			const panel = getPanels().find((p) => p.id === id);
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

			const cleanup = sseManager.addClient(eventStream);
			eventStream.onClosed(() => {
				cleanup();
			});

			// Send all panels immediately on connect (avoids blank panels on reconnect)
			const state = getState();
			for (const panel of getPanels()) {
				eventStream.push({
					event: panel.id,
					data: renderPanelFragment(panel, state),
				});
			}

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
