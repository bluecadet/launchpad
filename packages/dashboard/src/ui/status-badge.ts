import { escapeHtml } from "./helpers.js";
import type { StatusLevel } from "./types.js";

/**
 * Render a styled status badge.
 *
 * @example
 * statusBadge("Online", "success")
 * statusBadge("Error", "error")
 */
export function statusBadge(text: string, level: StatusLevel): string {
	return `<span class="badge badge--${escapeHtml(level)}">${escapeHtml(text)}</span>`;
}
