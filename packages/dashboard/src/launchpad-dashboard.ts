import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registry } from "@bluecadet/launchpad-utils/panel-registry";
import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { statusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { toNodeListener } from "h3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { DashboardCommand } from "./dashboard-commands.js";
import {
	type DashboardConfig,
	dashboardConfigSchema,
	type ResolvedDashboardConfig,
} from "./dashboard-config.js";
import type { DashboardPage } from "./dashboard-page.js";
import type { DashboardPanel } from "./dashboard-panel.js";
import { type DashboardState, DashboardStateManager } from "./dashboard-state.js";
import { dashboardStatusSection } from "./dashboard-status-section.js";
import "./dashboard-events.js";
import { createH3App } from "./server/h3-server.js";
import { SseManager } from "./server/sse-manager.js";
import { collectAllPanels } from "./server/templates/page-template.js";

const _require = createRequire(import.meta.url);

function startServer(
	config: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
): ResultAsync<ReturnType<typeof createServer>, Error> {
	const app = createH3App({
		getPanels: () => registry.getPanels() as DashboardPanel[],
		getPages: () => registry.getPages() as DashboardPage[],
		getState: ctx.getGlobalState,
		dispatchCommand: ctx.dispatchCommand,
		sseManager,
	});

	return ResultAsync.fromPromise(
		new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
			const server = createServer(toNodeListener(app));
			server.listen(config.port, config.host, () => {
				stateManager.setRunning(true);
				ctx.eventBus.emit("dashboard:server:started", {
					port: config.port,
					host: config.host,
				});
				ctx.logger.info(`Dashboard running at http://${config.host}:${config.port}`);
				resolve(server);
			});
			server.on("error", (error) => {
				ctx.eventBus.emit("dashboard:server:error", { error });
				reject(error);
			});
		}),
		(error) => new Error("Failed to start dashboard server", { cause: error }),
	);
}

function stopServer(
	server: ReturnType<typeof createServer>,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
): ResultAsync<void, Error> {
	return ResultAsync.fromPromise(
		new Promise<void>((resolve, reject) => {
			server.close((err) => {
				if (err) {
					reject(err);
				} else {
					stateManager.setRunning(false);
					ctx.eventBus.emit("dashboard:server:stopped", {});
					ctx.logger.info("Dashboard server stopped");
					resolve();
				}
			});
		}),
		(error) => new Error("Failed to stop dashboard server", { cause: error }),
	);
}

/**
 * Creates a Launchpad Dashboard plugin factory.
 *
 * Launches an HTTP server at the configured port with a server-driven UI.
 * Other plugins contribute pages and panels by passing them to the config.
 *
 * @example
 * ```ts
 * import { dashboard } from "@bluecadet/launchpad-dashboard";
 *
 * dashboard({ port: 3000 })
 * ```
 */
export function dashboard(config: DashboardConfig) {
	statusRegistry.contributeStatusSection(dashboardStatusSection);
	return definePlugin({
		name: "dashboard",
		setup(ctx: PluginContext<DashboardState>) {
			const configResult = dashboardConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(
					new Error("Invalid dashboard configuration", { cause: configResult.error }),
				);
			}
			const resolvedConfig = configResult.data;

			// Validate no duplicate page IDs
			const pageIds = resolvedConfig.pages.map((p) => p.id);
			const duplicatePageId = pageIds.find((id, i) => pageIds.indexOf(id) !== i);
			if (duplicatePageId) {
				return errAsync(new Error(`Duplicate dashboard page ID: "${duplicatePageId}"`));
			}

			// Validate no duplicate panel IDs in the raw input (before deduplication)
			const rawPanels = [
				...resolvedConfig.pages.flatMap((p) => p.panels ?? []),
				...resolvedConfig.panels,
			];
			const seenPanelIds = new Set<string>();
			for (const panel of rawPanels) {
				if (seenPanelIds.has(panel.id)) {
					return errAsync(new Error(`Duplicate dashboard panel ID: "${panel.id}"`));
				}
				seenPanelIds.add(panel.id);
			}

			// Push config panels/pages into the shared registry.
			// ContributedPanel/ContributedPage use `unknown` params for generality; cast is safe here.
			if (resolvedConfig.panels.length > 0) {
				registry.contributePanel(
					...(resolvedConfig.panels as Parameters<typeof registry.contributePanel>),
				);
			}
			if (resolvedConfig.pages.length > 0) {
				registry.contributePage(
					...(resolvedConfig.pages as Parameters<typeof registry.contributePage>),
				);
			}

			// Contribute base assets via file paths — routes are created automatically.
			registry.contributeStyle(fileURLToPath(new URL("../static/dashboard.css", import.meta.url)));
			registry.contributeScript(_require.resolve("htmx.org/dist/htmx.min.js"), { defer: true });
			registry.contributeScript(_require.resolve("htmx-ext-sse/sse.js"), { defer: true });

			const stateManager = new DashboardStateManager(
				ctx.updateState,
				resolvedConfig.port,
				resolvedConfig.host,
			);
			const sseManager = new SseManager();

			// Mutable server reference and SSE unsubscribe, managed by start/stop commands
			let activeServer: ReturnType<typeof createServer> | null = null;
			let unsubscribe: (() => void) | null = null;

			function doStart(): ResultAsync<ReturnType<typeof createServer>, Error> {
				unsubscribe = ctx.onGlobalStatePatch((patches) => {
					const pages = registry.getPages() as DashboardPage[];
					const standalonePanel = registry.getPanels() as DashboardPanel[];
					const panels = collectAllPanels(pages, standalonePanel);
					const state = ctx.getGlobalState();
					sseManager.broadcastAffectedPanels(panels, patches, state).catch((err: unknown) => {
						ctx.logger.error(
							"SSE broadcast error",
							err instanceof Error ? err : new Error(String(err)),
						);
					});
				});
				return startServer(resolvedConfig, ctx, stateManager, sseManager);
			}

			const executeCommand = (command: DashboardCommand): ResultAsync<void, Error> => {
				switch (command.type) {
					case "dashboard.start": {
						if (activeServer) {
							return errAsync(new Error("Dashboard server is already running"));
						}
						return doStart().map((server) => {
							activeServer = server;
						});
					}
					case "dashboard.stop": {
						if (!activeServer) return okAsync(undefined);
						const server = activeServer;
						activeServer = null;
						return stopServer(server, ctx, stateManager);
					}
					default: {
						return errAsync(
							new Error(`Unknown dashboard command type: ${(command as DashboardCommand).type}`),
						);
					}
				}
			};

			const disconnect = (_reason: DisconnectReason): ResultAsync<void, Error> => {
				unsubscribe?.();
				if (!activeServer) return okAsync(undefined);
				const server = activeServer;
				activeServer = null;
				return stopServer(server, ctx, stateManager);
			};

			return doStart().map((server) => {
				activeServer = server;
				return { executeCommand, disconnect };
			});
		},
	});
}
