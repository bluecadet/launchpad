/**
 * Converts a glob-style pattern (supporting * wildcards) into a RegExp.
 * Example: "log:*" → /^log:.*$/
 */
function patternToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const regexStr = escaped.replace(/\*/g, ".*");
	return new RegExp(`^${regexStr}$`);
}

/**
 * Returns true if the event name matches any of the given patterns.
 */
function matchesAnyPattern(event: string, patterns: string[]): boolean {
	return patterns.some((p) => patternToRegex(p).test(event));
}

/**
 * Determines whether an event should be forwarded to transports, given
 * include and exclude pattern lists.
 *
 * Rules:
 * - If include is empty, all events are included by default.
 * - If include is non-empty, only matching events are included.
 * - Exclude patterns always take precedence over include patterns.
 */
export function shouldIncludeEvent(event: string, include: string[], exclude: string[]): boolean {
	const included = include.length === 0 || matchesAnyPattern(event, include);
	if (!included) return false;
	const excluded = exclude.length > 0 && matchesAnyPattern(event, exclude);
	return !excluded;
}

export function makeEventFilter(include: string[], exclude: string[]): (event: string) => boolean {
	const includeRegexes = include.map(patternToRegex);
	const excludeRegexes = exclude.map(patternToRegex);
	return (event: string): boolean => {
		const included = includeRegexes.length === 0 || includeRegexes.some((r) => r.test(event));
		if (!included) return false;
		return excludeRegexes.length === 0 || !excludeRegexes.some((r) => r.test(event));
	};
}
