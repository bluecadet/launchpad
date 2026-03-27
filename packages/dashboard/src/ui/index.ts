export { commandButton } from "./command-button.js";
export { dataTable } from "./data-table.js";
export { escapeHtml, html, raw } from "./helpers.js";
export { statusBadge } from "./status-badge.js";
export type {
	CommandButtonOptions,
	DataTableOptions,
	RawHtml,
	StatusLevel,
	UiHelpers,
} from "./types.js";

import { commandButton } from "./command-button.js";
import { dataTable } from "./data-table.js";
import { escapeHtml, html, raw } from "./helpers.js";
import { statusBadge } from "./status-badge.js";
import type { UiHelpers } from "./types.js";

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
};
