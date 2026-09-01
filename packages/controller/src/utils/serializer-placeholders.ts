/**
 * Shared placeholder vocabulary for values neither serializer can represent
 * natively.
 *
 * `json-serializer.ts` (a lossy one-way JSON wire codec) and
 * `ipc-serializer.ts` (a devalue-based round-trip codec) are intentionally
 * separate implementations with their own traversal logic, but a degraded
 * function, symbol, `Map`, `Set`, or promise should read the same way
 * regardless of which serializer produced it. This module is the single
 * source of truth for those strings.
 */

/**
 * Common leading substring of every placeholder below. Callers that only need
 * to know *whether* a serialized payload degraded something — rather than
 * what — can test for this prefix instead of matching each placeholder.
 *
 * It detects only values that produce a placeholder. A `Date` has a native
 * `toJSON` and silently becomes an ISO string, so it is invisible to this
 * check; see the JSON-projection contract in
 * docs/reference/controller/transports.md.
 */
export const UNSERIALIZABLE_PREFIX = "[unserializable";

export const MAP_PLACEHOLDER = `${UNSERIALIZABLE_PREFIX}: map]`;
export const SET_PLACEHOLDER = `${UNSERIALIZABLE_PREFIX}: set]`;
export const PROMISE_PLACEHOLDER = `${UNSERIALIZABLE_PREFIX}: promise]`;

/** `name` is the function's own `.name`, which is `""` for anonymous functions. */
export function functionPlaceholder(name: string): string {
	return `${UNSERIALIZABLE_PREFIX}: function ${name || "anonymous"}]`;
}

/** `symbol.description` is `undefined` for a symbol created without one. */
export function symbolPlaceholder(symbol: symbol): string {
	return `${UNSERIALIZABLE_PREFIX}: symbol ${symbol.description ?? "anonymous"}]`;
}
