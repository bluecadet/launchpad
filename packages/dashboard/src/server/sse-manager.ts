import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { EventStream } from "h3";
import type { DashboardPanel } from "../dashboard-panel.js";
import { renderPanelFragment } from "./templates/panel-fragment.js";

/**
 * Manages connected SSE clients and broadcasts panel re-renders on state changes.
 */
export class SseManager {
	private readonly _clients = new Set<EventStream>();

	/**
	 * Register a connected SSE client stream.
	 * @returns An unsubscribe function to call when the client disconnects.
	 */
	addClient(stream: EventStream): () => void {
		this._clients.add(stream);
		return () => this._clients.delete(stream);
	}

	get clientCount(): number {
		return this._clients.size;
	}

	/**
	 * Broadcast a single panel re-render to all connected clients.
	 */
	async broadcastPanel(panel: DashboardPanel, state: VersionedLaunchpadState): Promise<void> {
		const html = renderPanelFragment(panel, state);
		const writes = Array.from(this._clients).map((client) =>
			client.push({ event: panel.id, data: html }).catch(() => {
				// Client disconnected mid-write; cleanup handled by onClosed in route
			}),
		);
		await Promise.allSettled(writes);
	}

	/**
	 * Broadcast all panels to all connected clients.
	 */
	async broadcastAllPanels(
		panels: DashboardPanel[],
		state: VersionedLaunchpadState,
	): Promise<void> {
		await Promise.allSettled(panels.map((panel) => this.broadcastPanel(panel, state)));
	}
}
