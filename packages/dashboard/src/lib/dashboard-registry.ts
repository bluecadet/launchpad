import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type {
	DashboardPage,
	DashboardPanel,
	DashboardRegistry,
	DashboardRouteHandler,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { SimpleRouter } from "./simple-router.js";

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

	constructor(private _router: SimpleRouter) {
		this._router.get("/", this.buildIndexPage.bind(this));

		// get import path for 'htmx.org' and register route to serve it
		const htmxPath = require.resolve("htmx.org/dist/htmx.min.js");
		this.registerJS(htmxPath);
	}

	private buildIndexPage(_req: IncomingMessage, res: ServerResponse) {
		const builtPage = pageTemplate({
			title: "Launchpad Dashboard",
			cssFiles: this._cssTransformedPaths,
			jsFiles: this._jsTransformedPaths,
		});

		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(builtPage);
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
		const newPath = `/static/${normalizedPath}`;

		// Register route to serve the file
		this._router.get(newPath, (req, res) => {
			switch (type) {
				case "css":
					res.writeHead(200, { "Content-Type": "text/css" });
					break;
				case "js":
					res.writeHead(200, { "Content-Type": "application/javascript" });
					break;
				default:
					res.writeHead(200, { "Content-Type": "text/plain" });
					break;
			}

			const fileStream = fs.createReadStream(originalPath);
			fileStream.pipe(res);
		});

		return newPath;
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
