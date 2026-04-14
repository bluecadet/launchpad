import { commandButton } from "./command-button.js";
import { dataTable } from "./data-table.js";
import { escapeHtml, html, raw } from "./helpers.js";
import { statusBadge } from "./status-badge.js";
import { formatDuration, relativeTime } from "./time.js";
import type {
	CommandButtonOptions,
	DataTableOptions,
	RawHtml,
	StatusLevel,
	UiHelpers,
} from "./types.js";

export type { CommandButtonOptions, DataTableOptions, RawHtml, StatusLevel, UiHelpers };
export {
	commandButton,
	dataTable,
	escapeHtml,
	formatDuration,
	html,
	raw,
	relativeTime,
	statusBadge,
};

/**
 * Pre-built UI helpers object passed to render functions.
 * Matches the UiHelpers interface.
 */
export const UI_HELPERS: UiHelpers = {
	html,
	raw,
	escapeHtml,
	commandButton,
	statusBadge,
	dataTable,
	relativeTime,
	formatDuration,
};
