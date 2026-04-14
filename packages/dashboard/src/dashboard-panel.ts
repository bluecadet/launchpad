import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { UiHelpers } from "./ui/types.js";

export type PanelRenderContext = {
	/** Pre-built UI helpers — no separate import needed. */
	ui: UiHelpers;
};

export type SseEventPush = (eventName: string, data: string) => void;

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
	/**
	 * Called once per new SSE client after the panel's initial render is pushed.
	 * Use to send supplemental events to that specific client only — for example,
	 * flushing a circular buffer of recent entries that live outside of state.
	 */
	onClientConnect?: (push: SseEventPush) => void;
	/**
	 * Called once when the server starts, before any clients connect.
	 * Receives a broadcast function that pushes events to ALL currently-connected clients.
	 * Use to wire up ongoing live event streams (e.g. subscribe to a data source).
	 * Must return a cleanup function that is called when the server stops.
	 */
	setupStreaming?: (broadcast: SseEventPush) => () => void;
};

export function definePanel(panel: DashboardPanel): DashboardPanel {
	return panel;
}
