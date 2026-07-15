const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Formats a millisecond count as the largest exact unit it divides evenly
 * into. Intended for rendering *configured* durations, e.g. `formatDurationMs(3_600_000)` -> `"1h"`.
 */
export function formatDurationMs(milliseconds: number): string {
	if (milliseconds === 0) return "0s";
	if (milliseconds % MS_PER_HOUR === 0) return `${milliseconds / MS_PER_HOUR}h`;
	if (milliseconds % MS_PER_MINUTE === 0) return `${milliseconds / MS_PER_MINUTE}m`;
	if (milliseconds % MS_PER_SECOND === 0) return `${milliseconds / MS_PER_SECOND}s`;
	return `${milliseconds}ms`;
}

type CoarseBucket = {
	value: number;
	unit: "h" | "m" | "s";
};

function coarseBucket(elapsedMilliseconds: number): CoarseBucket {
	if (elapsedMilliseconds >= MS_PER_HOUR) {
		return { value: Math.floor(elapsedMilliseconds / MS_PER_HOUR), unit: "h" };
	}
	if (elapsedMilliseconds >= MS_PER_MINUTE) {
		return { value: Math.floor(elapsedMilliseconds / MS_PER_MINUTE), unit: "m" };
	}
	return { value: Math.floor(elapsedMilliseconds / MS_PER_SECOND), unit: "s" };
}

/**
 * Formats how long ago `date` was relative to `now`, in a single coarse
 * bucket. Example: `formatTimeAgo(fiveMinutesAgo, now)` -> `"5m ago"`.
 */
export function formatTimeAgo(date: Date, now: Date): string {
	const elapsedMilliseconds = Math.max(0, now.getTime() - date.getTime());
	const bucket = coarseBucket(elapsedMilliseconds);
	return `${bucket.value}${bucket.unit} ago`;
}

/**
 * Formats how long until `date` relative to `now`, in a single coarse
 * bucket. Example: `formatTimeUntil(inFiveMinutes, now)` -> `"in 5m"`.
 */
export function formatTimeUntil(date: Date, now: Date): string {
	const remainingMilliseconds = Math.max(0, date.getTime() - now.getTime());
	const bucket = coarseBucket(remainingMilliseconds);
	return `in ${bucket.value}${bucket.unit}`;
}

/**
 * Formats a `Date` as zero-padded 24h local clock time. Example:
 * `formatClockTime(new Date(2024, 0, 1, 9, 5))` -> `"09:05"`.
 */
export function formatClockTime(date: Date): string {
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	return `${hours}:${minutes}`;
}
