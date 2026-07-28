/**
 * The lossy, one-way JSON wire codec for the HTTP/SSE transport.
 *
 * Every HTTP response body, SSE frame, and catch-up payload the controller
 * sends goes through `serializeJSON`. It always returns a string, even for
 * values `JSON.stringify` can't natively represent (bigint, Error, Map, Set,
 * functions, symbols) or would throw on (circular references). Unlike
 * `IPCSerializer`, the output is plain JSON with no reviver: it is not
 * designed to round-trip back into the original value. See
 * docs/src/reference/controller/transports.md for the documented lossiness
 * contract.
 */

import {
	functionPlaceholder,
	MAP_PLACEHOLDER,
	SET_PLACEHOLDER,
	symbolPlaceholder,
} from "./serializer-placeholders.js";

const CIRCULAR_PLACEHOLDER = "[unserializable: circular]";

type SerializedError = {
	name: string;
	message: string;
	cause?: unknown;
};

function errorToPlainObject(error: Error): SerializedError {
	if (error.cause === undefined) {
		return { name: error.name, message: error.message };
	}
	return { name: error.name, message: error.message, cause: error.cause };
}

/**
 * Builds the `JSON.stringify` replacer. `seen` records every object (and
 * Error, before it's flattened) visited so far; a repeated reference is
 * replaced with a placeholder instead of causing infinite recursion.
 *
 * Note: this flags any repeated reference, not just true cycles, so a DAG
 * with a diamond-shaped (but acyclic) reference will also show the
 * placeholder on its second visit. That's an accepted limitation in
 * exchange for a simple, always-safe implementation.
 */
function createReplacer() {
	const seen = new WeakSet<object>();

	return function replacer(_key: string, value: unknown): unknown {
		if (typeof value === "bigint") {
			return value.toString();
		}
		if (typeof value === "function") {
			return functionPlaceholder(value.name);
		}
		if (typeof value === "symbol") {
			return symbolPlaceholder(value);
		}
		if (value instanceof Map) {
			return MAP_PLACEHOLDER;
		}
		if (value instanceof Set) {
			return SET_PLACEHOLDER;
		}

		if (value instanceof Error) {
			if (seen.has(value)) {
				return CIRCULAR_PLACEHOLDER;
			}
			seen.add(value);
			return errorToPlainObject(value);
		}

		if (value !== null && typeof value === "object") {
			if (seen.has(value)) {
				return CIRCULAR_PLACEHOLDER;
			}
			seen.add(value);
		}

		return value;
	};
}

/**
 * Serializes any value to a JSON string. Never throws.
 *
 * - `Error` -> `{ name, message, cause? }`, with an `Error` cause serialized
 *   the same way (recursively, via the normal `JSON.stringify` traversal).
 * - `bigint` -> its decimal string representation.
 * - `Map` / `Set` / function / symbol -> a `"[unserializable: <kind>]"`
 *   placeholder string.
 * - `Date` -> an ISO string, via `Date`'s native `toJSON`.
 * - Circular (or merely repeated) references -> a
 *   `"[unserializable: circular]"` placeholder.
 * - A top-level value that `JSON.stringify` would turn into `undefined`
 *   (e.g. a bare top-level `undefined`) instead returns the string `"null"`,
 *   so the result is always parseable JSON.
 * - Anything else `JSON.stringify` throws on (a throwing getter, a throwing
 *   `toJSON`, or a `RangeError` from exceeding the call stack on extremely
 *   deep input) -> a `"[unserializable JSON payload: <error message>]"`
 *   placeholder. The replacer above already eliminates every circular or
 *   repeated reference before `JSON.stringify` recurses, so this catch can
 *   never actually fire for circularity.
 */
export function serializeJSON(value: unknown): string {
	try {
		const json = JSON.stringify(value, createReplacer());
		return json === undefined ? "null" : json;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return JSON.stringify(`[unserializable JSON payload: ${message}]`);
	}
}
