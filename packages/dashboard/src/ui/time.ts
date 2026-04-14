/**
 * Time formatting helpers for dashboard panels.
 */
import { raw } from "./helpers.js";
import type { RawHtml } from "./types.js";

/**
 * Format the difference between now and the given date as a compact string.
 * Used by both the server-side relativeTime() helper and the client-side refresh script.
 */
function formatRelative(d: Date): string {
	const diffMs = Date.now() - d.getTime();
	const diffSec = Math.floor(diffMs / 1000);

	if (diffSec < 5) return "just now";
	if (diffSec < 60) return `${diffSec}s ago`;

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;

	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour}h ago`;

	const diffDay = Math.floor(diffHour / 24);
	return `${diffDay}d ago`;
}

/**
 * Format a date as a human-readable relative time string inside a `<time>` element.
 * The `<time>` tag carries a `data-relative` attribute so the client-side
 * `relative-time.js` script can automatically refresh the displayed text.
 *
 * Returns a plain dash ("—") for undefined/null/invalid values (no `<time>` wrapper).
 *
 * @example
 * relativeTime(new Date(Date.now() - 90_000)) // raw('<time datetime="..." data-relative>1m ago</time>')
 * relativeTime(new Date(Date.now() - 500))    // raw('<time datetime="..." data-relative>just now</time>')
 * relativeTime(undefined)                     // raw("—")
 */
export function relativeTime(date: Date | string | undefined | null): RawHtml {
	if (date === undefined || date === null) return raw("—");

	const d = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(d.getTime())) return raw("—");

	const iso = d.toISOString();
	const text = formatRelative(d);
	return raw(`<time datetime="${iso}" data-relative>${text}</time>`);
}

/**
 * Format a duration in milliseconds as a compact string.
 *
 * @example
 * formatDuration(350)    // "350ms"
 * formatDuration(1234)   // "1.2s"
 * formatDuration(90_000) // "1m 30s"
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;

	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;

	const min = Math.floor(sec / 60);
	const remSec = Math.round(sec % 60);
	return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
}
