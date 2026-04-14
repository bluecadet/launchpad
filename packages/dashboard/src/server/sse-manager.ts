import type { Patch } from "@bluecadet/launchpad-utils/state-patcher";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { EventStream } from "h3";
import type { DashboardPanel } from "../dashboard-panel.js";
import { isPanelAffected } from "./state-tracker.js";
import { renderPanelFragmentTracked } from "./templates/panel-fragment.js";

/**
 * Manages connected SSE clients and broadcasts panel re-renders on state changes.
 */
export class SseManager {
	private readonly _clients = new Set<EventStream>();
	private readonly _panelDeps = new Map<string, Set<string>>();

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
	 * Close all connected SSE client streams.
	 * Used during graceful shutdown to drain connections before stopping the server.
	 */
	async closeAll(): Promise<void> {
		const closes = Array.from(this._clients).map((client) =>
			client.close().catch(() => {
				// Client may already be disconnected
			}),
		);
		await Promise.allSettled(closes);
		this._clients.clear();
	}

	/**
	 * Broadcast a single panel re-render to all connected clients.
	 * Records the state paths accessed during render for future dependency tracking.
	 */
	async broadcastPanel(panel: DashboardPanel, state: VersionedLaunchpadState): Promise<void> {
		const { html, accessed } = renderPanelFragmentTracked(panel, state);
		this._panelDeps.set(panel.id, accessed);
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

	/**
	 * Broadcast a named SSE event with arbitrary data to all connected clients.
	 * Used by panels that stream supplemental events beyond their own panel-id replace
	 * (e.g. the log panel appending individual log:entry events).
	 */
	async broadcastEvent(eventName: string, data: string): Promise<void> {
		const writes = Array.from(this._clients).map((client) =>
			client.push({ event: eventName, data }).catch(() => {
				// Client disconnected mid-write; cleanup handled by onClosed in route
			}),
		);
		await Promise.allSettled(writes);
	}

	/**
	 * Broadcast only the panels whose tracked dependencies intersect with the changed patches.
	 * Panels with no recorded deps (never rendered) are always included.
	 * Panels that declare setupStreaming manage their own live broadcasts and are excluded.
	 */
	async broadcastAffectedPanels(
		panels: DashboardPanel[],
		patches: Patch[],
		state: VersionedLaunchpadState,
	): Promise<void> {
		const affected = panels.filter((panel) => {
			if (panel.setupStreaming) return false;
			const deps = this._panelDeps.get(panel.id);
			return deps === undefined || isPanelAffected(deps, patches);
		});
		await Promise.allSettled(affected.map((panel) => this.broadcastPanel(panel, state)));
	}
}
