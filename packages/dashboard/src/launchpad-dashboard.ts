import { createServer } from "node:http";
import {
	type BaseCommand,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { toNodeListener } from "h3";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { DashboardCommand } from "./dashboard-commands.js";
import {
	type DashboardConfig,
	dashboardConfigSchema,
	type ResolvedDashboardConfig,
} from "./dashboard-config.js";
import { type DashboardState, DashboardStateManager } from "./dashboard-state.js";
import "./dashboard-events.js";
import { createH3App } from "./server/h3-server.js";
import { SseManager } from "./server/sse-manager.js";
import { collectAllPanels } from "./server/templates/page-template.js";

function startServer(
	config: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
): ResultAsync<ReturnType<typeof createServer>, Error> {
	const app = createH3App({
		config,
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
 * import { monitorPanel } from "@bluecadet/launchpad-monitor";
 *
 * dashboard({
 *   port: 3000,
 *   panels: [monitorPanel],
 * })
 * ```
 */
export function dashboard(config: DashboardConfig) {
	return definePlugin({
		name: "dashboard",
		startupCommands: [{ type: "dashboard.start" }] satisfies BaseCommand[],
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

			const allPanels = collectAllPanels(resolvedConfig.pages, resolvedConfig.panels);

			const stateManager = new DashboardStateManager(
				ctx.updateState,
				resolvedConfig.port,
				resolvedConfig.host,
			);
			const sseManager = new SseManager();

			// Broadcast all panels to SSE clients on any state change
			const unsubscribe = ctx.onGlobalStatePatch(() => {
				const state = ctx.getGlobalState();
				sseManager.broadcastAllPanels(allPanels, state).catch((err: unknown) => {
					ctx.logger.error(
						"SSE broadcast error",
						err instanceof Error ? err : new Error(String(err)),
					);
				});
			});

			// Mutable server reference, managed by start/stop commands
			let activeServer: ReturnType<typeof createServer> | null = null;

			return okAsync({
				executeCommand(command: DashboardCommand): ResultAsync<void, Error> {
					switch (command.type) {
						case "dashboard.start": {
							if (activeServer) {
								return errAsync(new Error("Dashboard server is already running"));
							}
							return startServer(resolvedConfig, ctx, stateManager, sseManager).map((server) => {
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
				},
				disconnect() {
					unsubscribe();
					if (!activeServer) return okAsync(undefined);
					const server = activeServer;
					activeServer = null;
					return stopServer(server, ctx, stateManager);
				},
			});
		},
	});
}
