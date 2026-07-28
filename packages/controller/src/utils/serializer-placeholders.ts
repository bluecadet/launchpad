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

export const MAP_PLACEHOLDER = "[unserializable: map]";
export const SET_PLACEHOLDER = "[unserializable: set]";
export const PROMISE_PLACEHOLDER = "[unserializable: promise]";

/** `name` is the function's own `.name`, which is `""` for anonymous functions. */
export function functionPlaceholder(name: string): string {
	return `[unserializable: function ${name || "anonymous"}]`;
}

/** `symbol.description` is `undefined` for a symbol created without one. */
export function symbolPlaceholder(symbol: symbol): string {
	return `[unserializable: symbol ${symbol.description ?? "anonymous"}]`;
}
