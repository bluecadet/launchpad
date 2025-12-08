import fs from "node:fs";
import { createRequire } from "node:module";
import { loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type {
	DashboardPage,
	DashboardPanel,
	DashboardRegistry,
	DashboardRouteHandler,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { type H3, type H3Event, HTTPError, html, serveStatic } from "h3";

const require = createRequire(import.meta.url);

const pageTemplate = await loadHandlebarsTemplate<{
	title: string;
	cssFiles: string[];
	jsFiles: string[];
}>(import.meta.resolve("../../templates/page.hbs"));

/**
 * Internal implementation of DashboardRegistry.
 * Maintains write-only interface for subsystems while providing private getters for the dashboard.
 */
export class DashboardRegistryImpl implements DashboardRegistry {
	private _panels = new Map<string, DashboardPanel>();
	private _pages = new Map<string, DashboardPage>();
	private _cssTransformedPaths: string[] = [];
	private _jsTransformedPaths: string[] = [];
	private _staticFileRegistry: Map<string, string> = new Map();

	constructor(private _h3: H3) {
		this._h3.get("/", this.buildIndexPage.bind(this));
		this._h3.get("/static/**", this.handleStaticFileRequest.bind(this));

		// get import path for 'htmx.org' and register route to serve it
		const htmxPath = require.resolve("htmx.org/dist/htmx.min.js");
		this.registerJS(htmxPath);
	}

	private buildIndexPage(_event: H3Event) {
		const builtPage = pageTemplate({
			title: "Launchpad Dashboard",
			cssFiles: this._cssTransformedPaths,
			jsFiles: this._jsTransformedPaths,
		});

		return html(builtPage);
	}

	private handleStaticFileRequest(event: H3Event) {
		return serveStatic(event, {
			getContents: async (id) => {
				const filePath = this._staticFileRegistry.get(id);

				if (!filePath) {
					throw new HTTPError("File not found", { statusCode: 404 });
				}

				return fs.createReadStream(filePath);
			},
			getMeta: async (id) => {
				const filePath = this._staticFileRegistry.get(id);

				if (!filePath) {
					throw new HTTPError("File not found", { statusCode: 404 });
				}

				const stats = await fs.promises.stat(filePath).catch(() => {});

				if (stats?.isFile()) {
					return {
						size: stats.size,
						mtime: stats.mtimeMs,
					};
				}
			},
		});
	}

	// ---- Getters for dashboard builder ----

	registerPanel(id: string, panel: DashboardPanel) {
		this._panels.set(id, panel);
		return this;
	}

	registerPage(id: string, page: DashboardPage) {
		this._pages.set(id, page);
		return this;
	}

	private transformPath(originalPath: string, type: "css" | "js" | "text" = "text"): string {
		// if it's a web path, return as is
		if (originalPath.startsWith("http://") || originalPath.startsWith("https://")) {
			return originalPath;
		}

		// otherwise, assume it's a local file. Serve from /static/, and strip leading slash if present
		const normalizedPath = originalPath.startsWith("/") ? originalPath.slice(1) : originalPath;

		const staticReqPath = `/static/${normalizedPath}`;

		this._staticFileRegistry.set(staticReqPath, originalPath);

		return staticReqPath;
	}

	registerCSS(path: string) {
		this._cssTransformedPaths.push(this.transformPath(path));
		return this;
	}

	registerJS(path: string) {
		this._jsTransformedPaths.push(this.transformPath(path));
		return this;
	}

	readonly api: DashboardRegistry["api"] = {
		get: (route: string, handler: DashboardRouteHandler) => {
			this._h3.get(route, handler);
			return this;
		},
		post: (route: string, handler: DashboardRouteHandler) => {
			this._h3.post(route, handler);
			return this;
		},
		put: (route: string, handler: DashboardRouteHandler) => {
			this._h3.put(route, handler);
			return this;
		},
		delete: (route: string, handler: DashboardRouteHandler) => {
			this._h3.delete(route, handler);
			return this;
		},
	};
}
