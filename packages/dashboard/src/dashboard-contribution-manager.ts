import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import type { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import type { ResolvedDashboardConfig } from "./dashboard-config.js";
import { dashboardStatusSection } from "./dashboard-status-section.js";

const _require = createRequire(import.meta.url);

type RouteKey = {
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
};

export type RegistrationHandle = {
	panelIds: string[];
	pageIds: string[];
	scriptPaths: string[];
	stylePaths: string[];
	routeKeys: RouteKey[];
};

/**
 * Manages dashboard UI contributions (panels, pages, scripts, styles, routes).
 * Encapsulates registration and cleanup lifecycle.
 */
export class DashboardContributionManager {
	private _handle: RegistrationHandle;

	constructor(
		private readonly _registry: DashboardRegistry,
		private readonly _statusRegistry: StatusRegistry,
	) {
		this._handle = {
			panelIds: [],
			pageIds: [],
			scriptPaths: [],
			stylePaths: [],
			routeKeys: [],
		};
	}

	/**
	 * Register user-configured panels, pages, and base dashboard assets.
	 */
	registerContributions(config: ResolvedDashboardConfig): RegistrationHandle {
		this._statusRegistry.contributeStatusSection(dashboardStatusSection);

		const panelIds = config.panels.map((panel) => panel.id);
		const pageIds = config.pages.map((page) => page.id);

		// ContributedPanel/ContributedPage use `unknown` params for generality; cast is safe here.
		if (config.panels.length > 0) {
			this._registry.contributePanel(
				...(config.panels as Parameters<typeof this._registry.contributePanel>),
			);
		}
		if (config.pages.length > 0) {
			this._registry.contributePage(
				...(config.pages as Parameters<typeof this._registry.contributePage>),
			);
		}

		const stylePaths = [fileURLToPath(new URL("../static/dashboard.css", import.meta.url))];
		const scriptPaths = [
			_require.resolve("htmx.org/dist/htmx.min.js"),
			_require.resolve("htmx-ext-sse/sse.js"),
			fileURLToPath(new URL("../static/json-enc.js", import.meta.url)),
			fileURLToPath(new URL("../static/relative-time.js", import.meta.url)),
		];

		for (const stylePath of stylePaths) {
			this._registry.contributeStyle(stylePath);
		}
		for (const scriptPath of scriptPaths) {
			this._registry.contributeScript(scriptPath, { defer: true });
		}

		this._handle = { panelIds, pageIds, scriptPaths, stylePaths, routeKeys: [] };
		return this._handle;
	}

	/** Get the mutable handle for adding more contributions later. */
	get handle(): RegistrationHandle {
		return this._handle;
	}

	/** Remove all registered contributions. */
	unregisterAll(): void {
		if (this._handle.panelIds.length > 0) {
			this._registry.removePanel(...this._handle.panelIds);
		}
		if (this._handle.pageIds.length > 0) {
			this._registry.removePage(...this._handle.pageIds);
		}
		if (this._handle.scriptPaths.length > 0) {
			this._registry.removeScript(...this._handle.scriptPaths);
		}
		if (this._handle.stylePaths.length > 0) {
			this._registry.removeStyle(...this._handle.stylePaths);
		}
		for (const { path, method } of this._handle.routeKeys) {
			this._registry.removeRoute(path, method);
		}
	}
}
