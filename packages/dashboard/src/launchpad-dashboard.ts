import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { defineEventHandler, toNodeListener } from "h3";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
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
import { createLogPanel, LOG_PANEL_ID } from "./server/log-panel.js";
import { SseManager } from "./server/sse-manager.js";
import { collectAllPanels } from "./server/templates/page-template.js";

const _require = createRequire(import.meta.url);

function getRegistryPanels(registry: DashboardRegistry): DashboardPanel[] {
	return registry.getPanels() as DashboardPanel[];
}

function getRegistryPages(registry: DashboardRegistry): DashboardPage[] {
	return registry.getPages() as DashboardPage[];
}

/**
 * Validate and resolve the raw dashboard config.
 * Checks zod schema, duplicate page IDs, and duplicate panel IDs.
 */
function validateDashboardConfig(config: DashboardConfig): Result<ResolvedDashboardConfig, Error> {
	const configResult = dashboardConfigSchema.safeParse(config);
	if (!configResult.success) {
		return err(new Error("Invalid dashboard configuration", { cause: configResult.error }));
	}
	const resolvedConfig = configResult.data;

	// Validate no duplicate page IDs
	const pageIds = resolvedConfig.pages.map((p) => p.id);
	const duplicatePageId = pageIds.find((id, i) => pageIds.indexOf(id) !== i);
	if (duplicatePageId) {
		return err(new Error(`Duplicate dashboard page ID: "${duplicatePageId}"`));
	}

	// Validate no duplicate panel IDs across pages and overview
	const rawPanels = [
		...resolvedConfig.pages.flatMap((p) => p.panels ?? []),
		...resolvedConfig.panels,
	];
	const seenPanelIds = new Set<string>();
	for (const panel of rawPanels) {
		if (seenPanelIds.has(panel.id)) {
			return err(new Error(`Duplicate dashboard panel ID: "${panel.id}"`));
		}
		seenPanelIds.add(panel.id);
	}

	return ok(resolvedConfig);
}

type RouteKey = { path: string; method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" };

type RegistrationHandle = {
	panelIds: string[];
	pageIds: string[];
	scriptPaths: string[];
	stylePaths: string[];
	routeKeys: RouteKey[];
};

/**
 * Register user-configured panels, pages, and base assets.
 * Returns a mutable handle used to accumulate and later remove all contributions.
 */
function registerDashboardContributions(
	resolvedConfig: ResolvedDashboardConfig,
	registry: DashboardRegistry,
	statusRegistry: StatusRegistry,
): RegistrationHandle {
	statusRegistry.contributeStatusSection(dashboardStatusSection);

	const panelIds = resolvedConfig.panels.map((p) => p.id);
	const pageIds = resolvedConfig.pages.map((p) => p.id);

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

	// Contribute base assets via file paths — asset routes are created automatically.
	const stylePaths = [fileURLToPath(new URL("../static/dashboard.css", import.meta.url))];
	const scriptPaths = [
		_require.resolve("htmx.org/dist/htmx.min.js"),
		_require.resolve("htmx-ext-sse/sse.js"),
		fileURLToPath(new URL("../static/json-enc.js", import.meta.url)),
		fileURLToPath(new URL("../static/relative-time.js", import.meta.url)),
	];

	for (const stylePath of stylePaths) {
		registry.contributeStyle(stylePath);
	}
	for (const scriptPath of scriptPaths) {
		registry.contributeScript(scriptPath, { defer: true });
	}

	return { panelIds, pageIds, scriptPaths, stylePaths, routeKeys: [] };
}

/**
 * Remove all contributions registered via the given handle.
 */
function unregisterDashboardContributions(
	handle: RegistrationHandle,
	registry: DashboardRegistry,
): void {
	if (handle.panelIds.length > 0) registry.removePanel(...handle.panelIds);
	if (handle.pageIds.length > 0) registry.removePage(...handle.pageIds);
	if (handle.scriptPaths.length > 0) registry.removeScript(...handle.scriptPaths);
	if (handle.stylePaths.length > 0) registry.removeStyle(...handle.stylePaths);
	for (const { path, method } of handle.routeKeys) {
		registry.removeRoute(path, method);
	}
}

function startServer(
	config: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
	registry: DashboardRegistry,
): ResultAsync<ReturnType<typeof createServer>, Error> {
	const app = createH3App({
		getPanels: () => getRegistryPanels(registry),
		getPages: () => getRegistryPages(registry),
		getState: ctx.getGlobalState,
		dispatchCommand: ctx.dispatchCommand,
		sseManager,
		getScripts: () => registry.getScripts(),
		getStyles: () => registry.getStyles(),
		getRoutes: () => registry.getRoutes(),
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
			server.close((closeErr) => {
				if (closeErr) {
					reject(closeErr);
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
 * Call setupStreaming() on every panel that declares it, wiring each panel's
 * live event stream into sseManager.broadcastEvent().
 * Returns a combined cleanup function.
 */
function setupPanelStreams(
	panels: DashboardPanel[],
	sseManager: SseManager,
	logger: PluginContext<DashboardState>["logger"],
): () => void {
	const cleanups: Array<() => void> = [];
	for (const panel of panels) {
		if (!panel.setupStreaming) continue;
		cleanups.push(
			panel.setupStreaming((eventName, data) => {
				sseManager.broadcastEvent(eventName, data).catch((err: unknown) => {
					logger.error(
						`SSE stream broadcast error (panel: ${panel.id})`,
						err instanceof Error ? err : new Error(String(err)),
					);
				});
			}),
		);
	}
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}

/**
 * Create the server lifecycle manager that encapsulates mutable server state.
 */
function createServerLifecycle(
	resolvedConfig: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
	registrationHandle: RegistrationHandle,
	registry: DashboardRegistry,
) {
	let activeServer: ReturnType<typeof createServer> | null = null;
	let unsubscribe: (() => void) | null = null;
	let stopStreams: (() => void) | null = null;

	function start(): ResultAsync<void, Error> {
		// Set up ongoing SSE streams for panels that declare them.
		// Must happen before startServer() so subscriptions are ready when the first client connects.
		const allPanels = collectAllPanels(getRegistryPages(registry), getRegistryPanels(registry));
		stopStreams = setupPanelStreams(allPanels, sseManager, ctx.logger);

		unsubscribe = ctx.onGlobalStatePatch((patches) => {
			const pages = getRegistryPages(registry);
			const panels = collectAllPanels(pages, getRegistryPanels(registry));
			const state = ctx.getGlobalState();
			sseManager.broadcastAffectedPanels(panels, patches, state).catch((broadcastErr: unknown) => {
				ctx.logger.error(
					"SSE broadcast error",
					broadcastErr instanceof Error ? broadcastErr : new Error(String(broadcastErr)),
				);
			});
		});

		return startServer(resolvedConfig, ctx, stateManager, sseManager, registry).map((server) => {
			activeServer = server;
		});
	}

	const executeCommand = (command: DashboardCommand): ResultAsync<void, Error> => {
		switch (command.type) {
			case "dashboard.start": {
				if (activeServer) {
					return errAsync(new Error("Dashboard server is already running"));
				}
				return start();
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
		stopStreams?.();
		unregisterDashboardContributions(registrationHandle, registry);
		const drainResult = ResultAsync.fromSafePromise(sseManager.closeAll());
		if (!activeServer) return drainResult;
		const server = activeServer;
		activeServer = null;
		return drainResult.andThen(() => stopServer(server, ctx, stateManager));
	};

	return { start, executeCommand, disconnect };
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
	return definePlugin({
		name: "dashboard",
		setup(ctx: PluginContext<DashboardState>) {
			const validationResult = validateDashboardConfig(config);
			if (validationResult.isErr()) return errAsync(validationResult.error);
			const resolvedConfig = validationResult.value;
			const dashboardRegistry = ctx.dashboardRegistry;
			const pluginStatusRegistry = ctx.statusRegistry;

			const registrationHandle = registerDashboardContributions(
				resolvedConfig,
				dashboardRegistry,
				pluginStatusRegistry,
			);

			if (resolvedConfig.logs !== false) {
				const { panel, clear } = createLogPanel(ctx.eventBus, resolvedConfig.logs.maxEntries);

				dashboardRegistry.contributePanel(
					panel as Parameters<typeof dashboardRegistry.contributePanel>[0],
				);
				registrationHandle.panelIds.push(LOG_PANEL_ID);

				const logScriptPath = fileURLToPath(new URL("../static/log-panel.js", import.meta.url));
				dashboardRegistry.contributeScript(logScriptPath, { defer: true });
				registrationHandle.scriptPaths.push(logScriptPath);

				dashboardRegistry.contributeRoute({
					method: "DELETE",
					path: "/logs",
					handler: defineEventHandler(() => {
						clear();
						return { ok: true };
					}),
				});
				registrationHandle.routeKeys.push({ path: "/logs", method: "DELETE" });
			}

			const stateManager = new DashboardStateManager(
				ctx.updateState,
				resolvedConfig.port,
				resolvedConfig.host,
			);
			const sseManager = new SseManager();
			const lifecycle = createServerLifecycle(
				resolvedConfig,
				ctx,
				stateManager,
				sseManager,
				registrationHandle,
				dashboardRegistry,
			);

			return lifecycle.start().map(() => ({
				executeCommand: lifecycle.executeCommand,
				disconnect: lifecycle.disconnect,
			}));
		},
	});
}
