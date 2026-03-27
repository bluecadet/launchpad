import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { DashboardPanel } from "./dashboard-panel.js";
import type { UiHelpers } from "./ui/types.js";

export type PageRenderContext = {
	/** Pre-built UI helpers — no separate import needed. */
	ui: UiHelpers;
	/**
	 * Render a panel within this page using the current state.
	 * Useful when composing a custom page layout around existing panels.
	 */
	renderPanel: (panel: DashboardPanel) => string;
};

export type DashboardPage = {
	/** Unique identifier. Used as the URL path segment: /pages/:id */
	id: string;
	/** Human-readable title shown in navigation and the browser tab. */
	title: string;
	/**
	 * URL path override. Defaults to /pages/:id.
	 * Must start with "/".
	 */
	path?: string;
	/**
	 * Panels to include on this page.
	 * If render() is also provided, panels are available via ctx.renderPanel()
	 * but are not automatically placed — the render function controls layout.
	 * If only panels is provided (no render), they are rendered in order.
	 */
	panels?: DashboardPanel[];
	/**
	 * Custom render function for full control over page body HTML.
	 * If omitted, panels are rendered in a default grid layout.
	 */
	render?: (state: VersionedLaunchpadState, ctx: PageRenderContext) => string;
};

export function definePage(page: DashboardPage): DashboardPage {
	return page;
}
