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
}>(import.meta.resolve("../../static/page.hbs"));

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
		this.registerJS(require.resolve("htmx.org/dist/htmx.min.js"));
		this.registerJS(require.resolve("htmx-ext-sse/dist/sse.min.js"));
		// register default CSS
		this.registerCSS(require.resolve("../../static/dashboard.css"));
		// register font files
		this.registerStatic(
			"/static/fonts/inter-latin-400-normal.woff2",
			require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff2"),
		);
		this.registerStatic(
			"/static/fonts/inter-latin-600-normal.woff2",
			require.resolve("@fontsource/inter/files/inter-latin-600-normal.woff2"),
		);
		this.registerStatic(
			"/static/fonts/monaspace-neon-latin-400-normal.woff2",
			require.resolve("@fontsource/monaspace-neon/files/monaspace-neon-latin-400-normal.woff2"),
		);
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

	private registerStatic(requestPath: string, originalPath: string) {
		this._staticFileRegistry.set(requestPath, originalPath);
		return this;
	}

	private normalizePath(path: string) {
		// otherwise, assume it's a local file. Serve from /static/, and strip leading slash if present
		const normalizedPath = path.startsWith("/") ? path.slice(1) : path;

		const staticReqPath = `/static/${normalizedPath}`;

		this._staticFileRegistry.set(staticReqPath, path);

		return staticReqPath;
	}

	registerCSS(path: string) {
		if (path.startsWith("http")) {
			this._cssTransformedPaths.push(path);
		} else {
			const staticPath = this.normalizePath(path);
			this.registerStatic(staticPath, path);
			this._cssTransformedPaths.push(staticPath);
		}
		return this;
	}

	registerJS(path: string) {
		if (path.startsWith("http")) {
			this._jsTransformedPaths.push(path);
		} else {
			const staticPath = this.normalizePath(path);
			this.registerStatic(staticPath, path);
			this._jsTransformedPaths.push(staticPath);
		}
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
