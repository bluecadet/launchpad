/**
 * Shared dashboard contribution registry.
 * Plugins call registry.contribute*() methods during setup() to register their UI and assets.
 * The dashboard reads the registry in executeCommand("dashboard.start") — after all
 * plugin setups have run — to build the server.
 */

import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

export interface ContributedPanel {
	id: string;
	title: string;
	render: (state: unknown, ctx: unknown) => string;
}

export interface ContributedPage {
	id: string;
	title: string;
	path?: string;
	panels?: ContributedPanel[];
	render?: (state: unknown, ctx: unknown) => string;
}

/** A JS file contributed from an absolute file path. URL is auto-generated. */
export interface ContributedScript {
	filePath: string;
	url: string;
	defer?: boolean;
}

/** A CSS file contributed from an absolute file path. URL is auto-generated. */
export interface ContributedStyle {
	filePath: string;
	url: string;
}

function assetUrl(filePath: string): string {
	const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 8);
	const ext = extname(filePath);
	const name = basename(filePath, ext);
	return `/assets/${name}-${hash}${ext}`;
}

export class DashboardRegistry {
	private readonly _panels: ContributedPanel[] = [];
	private readonly _pages: ContributedPage[] = [];
	private readonly _scripts: ContributedScript[] = [];
	private readonly _styles: ContributedStyle[] = [];

	contributePanel(...panels: ContributedPanel[]): void {
		this._panels.push(...panels);
	}

	contributePage(...pages: ContributedPage[]): void {
		this._pages.push(...pages);
	}

	/** Contribute a JS file by absolute path. No-op if the path is already registered. */
	contributeScript(filePath: string, opts?: { defer?: boolean }): void {
		if (!this._scripts.some((s) => s.filePath === filePath)) {
			this._scripts.push({ filePath, url: assetUrl(filePath), defer: opts?.defer });
		}
	}

	/** Contribute a CSS file by absolute path. No-op if the path is already registered. */
	contributeStyle(filePath: string): void {
		if (!this._styles.some((s) => s.filePath === filePath)) {
			this._styles.push({ filePath, url: assetUrl(filePath) });
		}
	}

	getPanels(): readonly ContributedPanel[] {
		return [...this._panels];
	}

	getPages(): readonly ContributedPage[] {
		return [...this._pages];
	}

	getScripts(): readonly ContributedScript[] {
		return [...this._scripts];
	}

	getStyles(): readonly ContributedStyle[] {
		return [...this._styles];
	}

	/** Reset all contributions. For test teardown only. */
	reset(): void {
		this._panels.length = 0;
		this._pages.length = 0;
		this._scripts.length = 0;
		this._styles.length = 0;
	}
}

/** The shared global registry instance. */
export const registry = new DashboardRegistry();
