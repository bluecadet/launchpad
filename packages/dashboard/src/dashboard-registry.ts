import type {
	DashboardPage,
	DashboardPanel,
	DashboardRegistry,
	DashboardRouteHandler,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { SimpleRouter } from "./lib/simple-router.js";

/**
 * Internal implementation of DashboardRegistry.
 * Maintains write-only interface for subsystems while providing private getters for the dashboard.
 */
export class DashboardRegistryImpl implements DashboardRegistry {
	private _panels = new Map<string, DashboardPanel>();
	private _pages = new Map<string, DashboardPage>();
	private _cssFiles: string[] = [];
	private _jsFiles: string[] = [];

	constructor(private _router: SimpleRouter) {}

	registerPanel(id: string, panel: DashboardPanel) {
		this._panels.set(id, panel);
		return this;
	}

	registerPage(id: string, page: DashboardPage) {
		this._pages.set(id, page);
		return this;
	}

	registerCSS(path: string) {
		this._cssFiles.push(path);
		return this;
	}

	registerJS(path: string) {
		this._jsFiles.push(path);
		return this;
	}

	readonly api: DashboardRegistry["api"] = {
		get: (route: string, handler: DashboardRouteHandler) => {
			this._router.get(route, handler);
			return this;
		},
		post: (route: string, handler: DashboardRouteHandler) => {
			this._router.post(route, handler);
			return this;
		},
		put: (route: string, handler: DashboardRouteHandler) => {
			this._router.put(route, handler);
			return this;
		},
		delete: (route: string, handler: DashboardRouteHandler) => {
			this._router.delete(route, handler);
			return this;
		},
	};
}
