import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { DashboardPage } from "../../dashboard-page.js";
import type { DashboardPanel } from "../../dashboard-panel.js";
import { escapeHtml } from "../../ui/helpers.js";
import { renderPanelContainer } from "./page-template.js";

/**
 * Render the dashboard index / overview page body.
 * Shows navigation links to all registered pages, followed by overview panels.
 */
export function renderIndexPageBody(
	pages: DashboardPage[],
	overviewPanels: DashboardPanel[],
	state: VersionedLaunchpadState,
): string {
	const nav =
		pages.length > 0
			? `<nav class="page-nav">
  <h2 class="page-nav__title">Pages</h2>
  <ul class="page-nav__list">
    ${pages.map((p) => `<li><a href="${escapeHtml(p.path ?? `/pages/${p.id}`)}">${escapeHtml(p.title)}</a></li>`).join("\n    ")}
  </ul>
</nav>`
			: "";

	const panels =
		overviewPanels.length > 0
			? `<div class="panel-grid">
  ${overviewPanels.map((p) => renderPanelContainer(p, state)).join("\n  ")}
</div>`
			: "";

	if (!nav && !panels) {
		return '<p class="empty-state">No pages or panels configured.</p>';
	}

	return [nav, panels].filter(Boolean).join("\n");
}
