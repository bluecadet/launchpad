/**
 * Time formatting helpers for dashboard panels.
 */

/**
 * Format a date as a human-readable relative time string.
 * Returns "—" for undefined/null values.
 *
 * @example
 * relativeTime(new Date(Date.now() - 90_000)) // "1m ago"
 * relativeTime(new Date(Date.now() - 500))    // "just now"
 * relativeTime(undefined)                     // "—"
 */
export function relativeTime(date: Date | string | undefined | null): string {
	if (date === undefined || date === null) return "—";

	const d = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(d.getTime())) return "—";

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
