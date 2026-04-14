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
import { SseManager } from "./server/sse-manager.js";
import { collectAllPanels } from "./server/templates/page-template.js";

const _require = createRequire(import.meta.url);

function getRegistryPanels(): DashboardPanel[] {
	return registry.getPanels() as DashboardPanel[];
}

function getRegistryPages(): DashboardPage[] {
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

type RegistrationHandle = {
	panelIds: string[];
	pageIds: string[];
	scriptPaths: string[];
	stylePaths: string[];
};

/**
 * Register all dashboard contributions: panels, pages, assets, and status section.
 * Returns a handle that can be used to remove contributions during disconnect.
 */
function registerDashboardContributions(
	resolvedConfig: ResolvedDashboardConfig,
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

	// Contribute base assets via file paths — routes are created automatically.
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

	return { panelIds, pageIds, scriptPaths, stylePaths };
}

/**
 * Remove all contributions registered via the given handle.
 */
function unregisterDashboardContributions(handle: RegistrationHandle): void {
	if (handle.panelIds.length > 0) registry.removePanel(...handle.panelIds);
	if (handle.pageIds.length > 0) registry.removePage(...handle.pageIds);
	if (handle.scriptPaths.length > 0) registry.removeScript(...handle.scriptPaths);
	if (handle.stylePaths.length > 0) registry.removeStyle(...handle.stylePaths);
}

function startServer(
	config: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
): ResultAsync<ReturnType<typeof createServer>, Error> {
	const app = createH3App({
		getPanels: getRegistryPanels,
		getPages: getRegistryPages,
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
 * Create the server lifecycle manager that encapsulates mutable server state.
 */
function createServerLifecycle(
	resolvedConfig: ResolvedDashboardConfig,
	ctx: PluginContext<DashboardState>,
	stateManager: DashboardStateManager,
	sseManager: SseManager,
	registrationHandle: RegistrationHandle,
) {
	let activeServer: ReturnType<typeof createServer> | null = null;
	let unsubscribe: (() => void) | null = null;

	function start(): ResultAsync<void, Error> {
		unsubscribe = ctx.onGlobalStatePatch((patches) => {
			const pages = getRegistryPages();
			const panels = collectAllPanels(pages, getRegistryPanels());
			const state = ctx.getGlobalState();
			sseManager.broadcastAffectedPanels(panels, patches, state).catch((broadcastErr: unknown) => {
				ctx.logger.error(
					"SSE broadcast error",
					broadcastErr instanceof Error ? broadcastErr : new Error(String(broadcastErr)),
				);
			});
		});
		return startServer(resolvedConfig, ctx, stateManager, sseManager).map((server) => {
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
		unregisterDashboardContributions(registrationHandle);
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

			const registrationHandle = registerDashboardContributions(resolvedConfig);

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
			);

			return lifecycle.start().map(() => ({
				executeCommand: lifecycle.executeCommand,
				disconnect: lifecycle.disconnect,
			}));
		},
	});
}
