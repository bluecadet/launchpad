import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { UiHelpers } from "./ui/types.js";

export type PanelRenderContext = {
	/** Pre-built UI helpers — no separate import needed. */
	ui: UiHelpers;
};

export type DashboardPanel = {
	/** Unique identifier. Used as the SSE event name and DOM element ID. */
	id: string;
	/** Human-readable title shown in the panel header. */
	title: string;
	/**
	 * Render the panel content as an HTML string.
	 * Must be synchronous. Errors are caught and replaced with an error fragment.
	 * State slices from other plugins are optional — guard against undefined.
	 */
	render: (state: VersionedLaunchpadState, ctx: PanelRenderContext) => string;
};

export function definePanel(panel: DashboardPanel): DashboardPanel {
	return panel;
}
