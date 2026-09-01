/**
 * Prefix-glob matching, shared by the SSE event filter, the transport-wide
 * `allowedCommands` list, and token role allowlists.
 *
 * One implementation on purpose: an operator who has learned the syntax from
 * the `events` option should be able to reuse it verbatim for roles. The
 * flip side is that changing the semantics here changes all three at once.
 */

/**
 * Build a predicate over a pattern list. An entry ending in `*` prefix-matches
 * everything before it; the single entry `*` matches everything; any other
 * entry is an exact match. An empty list matches nothing, which is the
 * fail-closed default a role with no commands wants.
 */
export function createPatternMatcher(patterns: readonly string[]): (value: string) => boolean {
	return (value) =>
		patterns.some((pattern) => {
			if (pattern.endsWith("*")) {
				return value.startsWith(pattern.slice(0, -1));
			}
			return value === pattern;
		});
}
