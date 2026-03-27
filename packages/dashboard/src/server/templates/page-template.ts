import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { DashboardPage } from "../../dashboard-page.js";
import type { DashboardPanel } from "../../dashboard-panel.js";
import { escapeHtml } from "../../ui/helpers.js";
import { UI_HELPERS } from "../../ui/index.js";
import { renderPanelFragment } from "./panel-fragment.js";

/**
 * Collect all panels from a set of pages and top-level overview panels.
 * Used to build the SSE subscription list.
 */
export function collectAllPanels(
	pages: DashboardPage[],
	overviewPanels: DashboardPanel[],
): DashboardPanel[] {
	const seen = new Set<string>();
	const result: DashboardPanel[] = [];

	const add = (panel: DashboardPanel) => {
		if (!seen.has(panel.id)) {
			seen.add(panel.id);
			result.push(panel);
		}
	};

	for (const page of pages) {
		for (const panel of page.panels ?? []) {
			add(panel);
		}
	}
	for (const panel of overviewPanels) {
		add(panel);
	}

	return result;
}

/**
 * Render a panel wrapped in its SSE-connected container div.
 * The container is the htmx SSE swap target for live updates.
 */
export function renderPanelContainer(
	panel: DashboardPanel,
	state: VersionedLaunchpadState,
): string {
	const content = renderPanelFragment(panel, state);
	return `<div class="panel" id="panel-${escapeHtml(panel.id)}" sse-swap="${escapeHtml(panel.id)}" hx-swap="innerHTML">
  <div class="panel__header">
    <h2 class="panel__title">${escapeHtml(panel.title)}</h2>
  </div>
  <div class="panel__body">${content}</div>
</div>`;
}

/**
 * Render the body of a DashboardPage.
 * If the page has a custom render() function, that takes control.
 * Otherwise, panels are laid out in a default grid.
 */
export function renderPageBody(page: DashboardPage, state: VersionedLaunchpadState): string {
	if (page.render) {
		const renderPanel = (panel: DashboardPanel) => renderPanelContainer(panel, state);
		try {
			return page.render(state, { ui: UI_HELPERS, renderPanel });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `<div class="page-error"><strong>Page render error:</strong> ${escapeHtml(message)}</div>`;
		}
	}

	const panels = page.panels ?? [];
	if (panels.length === 0) {
		return '<p class="empty-state">No panels configured for this page.</p>';
	}

	return `<div class="panel-grid">${panels.map((p) => renderPanelContainer(p, state)).join("\n")}</div>`;
}
