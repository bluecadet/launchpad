import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { DashboardPanel } from "../../dashboard-panel.js";
import { escapeHtml } from "../../ui/helpers.js";
import { UI_HELPERS } from "../../ui/index.js";

/**
 * Render a panel's content HTML fragment.
 * Errors from the render function are caught and replaced with a styled error message,
 * so a broken panel never crashes the SSE stream.
 */
export function renderPanelFragment(panel: DashboardPanel, state: VersionedLaunchpadState): string {
	try {
		return panel.render(state, { ui: UI_HELPERS });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return `<div class="panel-error"><strong>Render error in "${escapeHtml(panel.id)}":</strong> ${escapeHtml(message)}</div>`;
	}
}
