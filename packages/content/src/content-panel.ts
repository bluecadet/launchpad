import type { DashboardPanel, PanelRenderContext } from "@bluecadet/launchpad-dashboard/panel";
import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { ContentState, SourceFetchState } from "./content-state.js";

function phaseLabel(phase: ContentState["phase"]): string {
	const labels: Record<string, string> = {
		idle: "Idle",
		"resolving-sources": "Resolving sources",
		"fetching-sources": "Fetching",
		"running-transforms": "Transforming",
		"backing-up": "Backing up",
		"clearing-old-data": "Clearing old data",
		"clearing-temp": "Clearing temp",
		finalizing: "Finalizing",
		error: "Error",
	};
	return labels[phase] ?? phase;
}

function phaseLevel(
	phase: ContentState["phase"],
): "success" | "warning" | "error" | "info" | "neutral" {
	if (phase === "idle") return "neutral";
	if (phase === "error") return "error";
	if (phase === "finalizing") return "success";
	return "info";
}

function renderSourceRow(
	id: string,
	source: SourceFetchState,
	ui: PanelRenderContext["ui"],
): string {
	let statusBadge: string;
	let duration = "—";
	let lastFetch = "—";

	switch (source.state) {
		case "pending":
			statusBadge = ui.statusBadge("Pending", "neutral");
			break;
		case "fetching": {
			const elapsed = Date.now() - source.startTime.getTime();
			statusBadge = ui.statusBadge("Fetching", "info");
			duration = `${ui.formatDuration(elapsed)}…`;
			lastFetch = "now";
			break;
		}
		case "success":
			statusBadge = ui.statusBadge("Success", "success");
			duration = ui.formatDuration(source.duration);
			lastFetch = ui.relativeTime(source.finishedAt);
			break;
		case "error": {
			const errorMsg = source.error.message;
			statusBadge = ui.statusBadge(
				source.restored ? "Restored" : "Error",
				source.restored ? "warning" : "error",
			);
			duration = "—";
			lastFetch = ui.relativeTime(source.attemptedAt);
			return ui.html`
<tr>
  <td>${id}</td>
  <td>${ui.raw(statusBadge)}</td>
  <td class="text-muted">—</td>
  <td class="text-muted">${lastFetch}</td>
  <td class="text-muted source-error" colspan="1" title="${errorMsg}">${errorMsg.slice(0, 40)}${errorMsg.length > 40 ? "…" : ""}</td>
  <td>${ui.raw(ui.commandButton("↺", { type: "content.fetch", sources: [id] }, { class: "btn btn--icon" }))}</td>
</tr>`;
		}
	}

	return ui.html`
<tr>
  <td>${id}</td>
  <td>${ui.raw(statusBadge)}</td>
  <td class="text-muted">${duration}</td>
  <td class="text-muted">${lastFetch}</td>
  <td></td>
  <td>${ui.raw(ui.commandButton("↺", { type: "content.fetch", sources: [id] }, { class: "btn btn--icon" }))}</td>
</tr>`;
}

function renderContentBody(content: ContentState | undefined, { ui }: PanelRenderContext): string {
	if (!content) {
		return ui.html`<p class="empty-state">Content plugin not active.</p>`;
	}

	const phaseBadge = ui.statusBadge(phaseLabel(content.phase), phaseLevel(content.phase));

	// If error phase, show the error message
	const errorNote =
		content.phase === "error"
			? ui.html`<p class="panel-error" style="margin-top:0.5rem">${content.error.message}</p>`
			: "";

	const phaseRow = ui.html`
<div class="meta-row">
  <span class="meta-label">Phase</span>
  ${ui.raw(phaseBadge)}
  ${errorNote}
</div>`;

	const fetchAllBtn = ui.commandButton(
		"Fetch All",
		{ type: "content.fetch" },
		{ class: "btn btn--sm" },
	);
	const actionsRow = ui.html`<div class="panel-actions">${ui.raw(fetchAllBtn)}</div>`;

	const sources = Object.entries(content.sources);
	if (sources.length === 0) {
		return ui.html`
${ui.raw(phaseRow)}
${ui.raw(actionsRow)}
<p class="empty-state" style="margin-top:0.75rem">No sources configured.</p>`;
	}

	const sourceRows = sources.map(([id, source]) => renderSourceRow(id, source, ui)).join("");

	return ui.html`
${ui.raw(phaseRow)}
${ui.raw(actionsRow)}
<table class="data-table" style="margin-top:0.75rem">
  <thead>
    <tr>
      <th>Source</th><th>Status</th><th>Duration</th><th>Last Fetch</th><th></th><th></th>
    </tr>
  </thead>
  <tbody>${ui.raw(sourceRows)}</tbody>
</table>`;
}

/**
 * Dashboard panel showing the content pipeline phase and per-source fetch states.
 * Pass to `dashboard({ panels: [contentPanel] })` or include in a page.
 */
export const contentPanel: DashboardPanel = {
	id: "content",
	title: "Content",
	render(state: VersionedLaunchpadState, ctx: PanelRenderContext): string {
		return renderContentBody(state.plugins.content, ctx);
	},
};
