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

type RenderedPageContent =
	| {
			raw: string;
	  }
	| {
			panels: {
				title: string;
				content: string;
			}[];
	  };

const pageTemplate = await loadHandlebarsTemplate<{
	title: string;
	cssFiles: string[];
	jsFiles: string[];
	pages: DashboardPage[];
	content: RenderedPageContent;
}>(import.meta.resolve("../../templates/page.hbs"));

/**
 * Internal implementation of DashboardRegistry.
 * Maintains write-only interface for subsystems while providing private getters for the dashboard.
 */
export class DashboardRegistryImpl implements DashboardRegistry {
	private _indexPanels: DashboardPanel[] = [];
	private _pages: DashboardPage[] = [];
	private _cssTransformedPaths: string[] = [];
	private _jsTransformedPaths: string[] = [];
	private _staticFileRegistry: Map<string, string> = new Map();

	constructor(private _h3: H3) {
		this._h3.get("/static/**", this.handleStaticFileRequest.bind(this));

		this.registerPage({
			title: "Home",
			slug: "",
			panels: this._indexPanels,
		});

		// get import path for 'htmx.org' and register route to serve it
		const htmxPath = require.resolve("htmx.org/dist/htmx.min.js");
		this.registerJS(htmxPath);
		const htmxExtSsePath = require.resolve("htmx-ext-sse/dist/sse.min.js");
		this.registerJS(htmxExtSsePath);
	}

	private static async compilePageContent(page: DashboardPage): Promise<RenderedPageContent> {
		if ("render" in page) {
			const content = typeof page.render === "function" ? await page.render() : page.render;
			return { raw: content };
		}

		const panelRenders = page.panels
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map(async ({ render, order, ...panel }) => {
				const panelContent = typeof render === "function" ? await render() : render;

				return {
					...panel,
					content: panelContent,
				};
			});

		const panels = await Promise.all(panelRenders);

		return {
			panels,
		};
	}

	private async buildPageResponse(page: DashboardPage) {
		const content = await DashboardRegistryImpl.compilePageContent(page);

		const builtPage = pageTemplate({
			title: "Launchpad Dashboard",
			cssFiles: this._cssTransformedPaths,
			jsFiles: this._jsTransformedPaths,
			content,
			pages: this._pages,
		});

		return html(builtPage);
	}

	private handleStaticFileRequest(event: H3Event) {
		return serveStatic(event, {
			getContents: async (id) => {
				const filePath = this._staticFileRegistry.get(id);

				if (filePath) {
					return fs.createReadStream(filePath);
				}
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

	registerPanel(panel: DashboardPanel) {
		this._indexPanels.push(panel);
		return this;
	}

	registerPage(page: DashboardPage) {
		this._pages.push(page);
		this._h3.get(`/${page.slug}`, this.buildPageResponse.bind(this, page));
		return this;
	}

	private registerAssetPath(originalPath: string, type: "css" | "js"): string {
		// if it's a web path, return as is
		if (originalPath.startsWith("http://") || originalPath.startsWith("https://")) {
			return originalPath;
		}

		// otherwise, assume it's a local file. Serve from /static/, and strip leading slash if present
		const normalizedPath = originalPath.startsWith("/") ? originalPath.slice(1) : originalPath;

		const staticReqPath = `/static/${normalizedPath}`;

		this._staticFileRegistry.set(staticReqPath, originalPath);

		if (type === "css") {
			this._cssTransformedPaths.push(staticReqPath);
		} else {
			this._jsTransformedPaths.push(staticReqPath);
		}

		return staticReqPath;
	}

	registerCSS(path: string) {
		this.registerAssetPath(path, "css");
		return this;
	}

	registerJS(path: string) {
		this.registerAssetPath(path, "js");
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
		patch: (route: string, handler: DashboardRouteHandler) => {
			this._h3.patch(route, handler);
			return this;
		},
		delete: (route: string, handler: DashboardRouteHandler) => {
			this._h3.delete(route, handler);
			return this;
		},
	};
}
