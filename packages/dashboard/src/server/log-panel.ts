import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { LogEventPayload, LogLevel } from "@bluecadet/launchpad-utils/logger";
import type { DashboardPanel } from "../dashboard-panel.js";
import { escapeHtml } from "../ui/helpers.js";
import { LogBuffer, type LogEntry } from "./log-buffer.js";

export const LOG_PANEL_ID = "logs";

/** SSE event name used to stream individual log entries to the client. */
export const LOG_SSE_EVENT = "log:entry";

const LEVEL_LABELS = {
	error: "Error",
	warn: "Warn",
	info: "Info",
	debug: "Debug",
	verbose: "Verbose",
} as const;

/**
 * Render a single log entry as an HTML fragment.
 * Used both for the initial SSE buffer flush and for live broadcasts.
 */
export function renderLogEntry(entry: LogEntry): string {
	const ts = entry.timestamp.toISOString().replace("T", " ").slice(0, 23);
	const moduleHtml = entry.module
		? ` <span class="log-entry__module">${escapeHtml(entry.module)}</span>`
		: "";
	return `<div class="log-entry log-entry--${escapeHtml(entry.level)}" data-level="${escapeHtml(entry.level)}" data-id="${escapeHtml(entry.id)}"><span class="log-entry__ts">${escapeHtml(ts)}</span> <span class="log-entry__level">${escapeHtml(entry.level.toUpperCase())}</span>${moduleHtml} <span class="log-entry__msg">${escapeHtml(entry.message)}</span></div>`;
}

function subscribeToLogEvents(eventBus: EventBus, logBuffer: LogBuffer): () => void {
	const handler = (event: string, data: unknown): void => {
		const match = /^log:(error|warn|info|debug|verbose)$/.exec(event);
		if (!match) return;
		const level = match[1] as LogLevel;
		const payload = data as LogEventPayload;
		logBuffer.push(level, payload.message, payload.module);
	};

	eventBus.onAny(handler as Parameters<typeof eventBus.onAny>[0]);
	return () => eventBus.offAny(handler as Parameters<typeof eventBus.offAny>[0]);
}

export type LogPanelHandle = {
	panel: DashboardPanel;
	/** Clear all buffered log entries (e.g. wired to DELETE /logs). */
	clear: () => void;
};

/**
 * Create the log panel and its associated buffer.
 *
 * All log-specific concerns live here: buffer creation, event bus subscription,
 * per-client flush, and live broadcast. Nothing leaks into the dashboard wiring layer.
 *
 * - onClientConnect: flushes the current buffer to each newly connected SSE client.
 * - setupStreaming: subscribes to log events AND wires new entries to the broadcast
 *   function. Returns a combined cleanup that undoes both subscriptions.
 */
export function createLogPanel(eventBus: EventBus, maxEntries: number): LogPanelHandle {
	const logBuffer = new LogBuffer(maxEntries);

	const levelButtons = (Object.keys(LEVEL_LABELS) as Array<keyof typeof LEVEL_LABELS>)
		.map(
			(level) =>
				`<button class="log-level-btn log-level-btn--active" data-level="${level}">${LEVEL_LABELS[level]}</button>`,
		)
		.join("");

	const panel: DashboardPanel = {
		id: LOG_PANEL_ID,
		title: "Logs",
		render() {
			// Render the full buffer inline so entries are present immediately on both
			// initial page load (SSR) and on SSE connect/reconnect (panel body replacement).
			// Live entries after connect are appended via htmx:sseMessage in log-panel.js.
			const entriesHtml = logBuffer.getAll().map(renderLogEntry).join("");
			return `<div class="log-panel">
  <div class="log-panel__toolbar">
    <input type="search" class="log-search" placeholder="Filter logs…" autocomplete="off" />
    <div class="log-panel__levels">${levelButtons}</div>
  </div>
  <div class="log-panel__entries" data-max-entries="${logBuffer.maxEntries}">${entriesHtml}</div>
</div>`;
		},
		setupStreaming(broadcast) {
			const unsubscribeEvents = subscribeToLogEvents(eventBus, logBuffer);
			const unsubscribeBuffer = logBuffer.onEntry((entry) => {
				broadcast(LOG_SSE_EVENT, renderLogEntry(entry));
			});
			return () => {
				unsubscribeEvents();
				unsubscribeBuffer();
			};
		},
	};

	return { panel, clear: () => logBuffer.clear() };
}
