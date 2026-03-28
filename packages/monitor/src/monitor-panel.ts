import type { DashboardPanel, PanelRenderContext } from "@bluecadet/launchpad-dashboard/panel";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { MonitorState } from "./monitor-state.js";

function renderMonitorContent(
	monitor: MonitorState | undefined,
	{ ui }: PanelRenderContext,
): string {
	if (!monitor) {
		return ui.html`<p class="empty-state">Monitor plugin not active.</p>`;
	}

	// Connection header
	const connectionBadge = monitor.isConnected
		? ui.statusBadge("Connected", "success")
		: ui.statusBadge("Disconnected", "error");

	const connectionMeta = monitor.isConnected
		? ui.html`since ${ui.relativeTime(monitor.lastConnect)}`
		: ui.html`last connected ${ui.relativeTime(monitor.lastConnect)}`;

	const connectionRow = ui.html`
<div class="meta-row">
  <span class="meta-label">PM2</span>
  ${ui.raw(connectionBadge)}
  <span class="meta-value text-muted">${connectionMeta}</span>
</div>`;

	// No apps configured
	const apps = Object.entries(monitor.apps);
	if (apps.length === 0) {
		return ui.html`${ui.raw(connectionRow)}<p class="empty-state" style="margin-top:0.75rem">No apps configured.</p>`;
	}

	// Per-app rows
	const appRows = apps
		.map(([name, app]) => {
			const statusLevel =
				app.status === "online" ? "success" : app.status === "errored" ? "error" : "neutral";

			const pidCell = app.pid !== undefined ? String(app.pid) : "—";
			const lastStart = ui.relativeTime(app.lastStart);
			const lastError =
				app.status === "errored" ? ui.html` · error ${ui.relativeTime(app.lastError)}` : "";

			const restartBtn = ui.commandButton(
				"↺",
				{ type: "monitor.restart", appNames: [name] },
				{
					class: "btn btn--icon",
					confirm: `Restart ${name}?`,
				},
			);
			const stopBtn = ui.commandButton(
				"■",
				{ type: "monitor.stop", appNames: [name] },
				{
					class: "btn btn--icon",
					disabled: app.status === "offline",
				},
			);
			const startBtn = ui.commandButton(
				"▶",
				{ type: "monitor.start", appNames: [name] },
				{
					class: "btn btn--icon",
					disabled: app.status === "online",
				},
			);

			return ui.html`
<tr>
  <td>${name}</td>
  <td>${ui.raw(ui.statusBadge(app.status, statusLevel))}</td>
  <td class="text-muted">${pidCell}</td>
  <td class="text-muted">${lastStart}${lastError}</td>
  <td class="btn-group">${ui.raw(restartBtn)}${ui.raw(stopBtn)}${ui.raw(startBtn)}</td>
</tr>`;
		})
		.join("");

	// Bulk action buttons
	const bulkActions = ui.html`
<div class="panel-actions">
  ${ui.raw(ui.commandButton("Start All", { type: "monitor.start" }, { class: "btn btn--sm" }))}
  ${ui.raw(ui.commandButton("Restart All", { type: "monitor.restart" }, { class: "btn btn--sm" }))}
  ${ui.raw(ui.commandButton("Stop All", { type: "monitor.stop" }, { class: "btn btn--sm", confirm: "Stop all apps?" }))}
</div>`;

	return ui.html`
${ui.raw(connectionRow)}
${ui.raw(bulkActions)}
<table class="data-table" style="margin-top:0.75rem">
  <thead>
    <tr>
      <th>App</th><th>Status</th><th>PID</th><th>Last Start</th><th></th>
    </tr>
  </thead>
  <tbody>${ui.raw(appRows)}</tbody>
</table>`;
}

/**
 * Dashboard panel showing PM2 connection status and per-app controls.
 * Pass to `dashboard({ panels: [monitorPanel] })` or include in a page.
 */
export const monitorPanel: DashboardPanel = {
	id: "monitor",
	title: "Monitor",
	render(state: VersionedLaunchpadState, ctx: PanelRenderContext): string {
		return renderMonitorContent(state.plugins.monitor, ctx);
	},
};
