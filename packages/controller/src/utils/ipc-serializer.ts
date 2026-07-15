/**
 * Wraps devalue serialization for IPC messages.
 *
 * `serialize` must never throw. Event and state payloads can contain arbitrary
 * values from plugins and third-party libraries — class instances, functions,
 * error types that don't extend Error (e.g. airtable's AirtableError). If
 * devalue rejects the payload, it is sanitized into a devalue-safe equivalent
 * and retried.
 */

import * as devalue from "devalue";

type ErrorObj = {
	name: string;
	message: string;
	stack?: string;
	cause?: unknown;
};

const reducers = {
	Error: (value: unknown) => value instanceof Error && errToObj(value),
};

const revivers = {
	Error: (value: unknown) => objToErr(value as ErrorObj),
};

function errToObj(error: Error): ErrorObj {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		// devalue applies reducers to this object's values, so an Error cause is
		// reduced (and later revived) recursively without explicit recursion here.
		cause: error.cause,
	};
}

function objToErr(obj: ErrorObj): Error {
	const error = new Error(obj.message);
	error.name = obj.name;
	error.stack = obj.stack;
	if (obj.cause !== undefined) {
		error.cause = obj.cause;
	}
	return error;
}

function serialize(data: unknown): string {
	try {
		return devalue.stringify(data, reducers);
	} catch {
		try {
			return devalue.stringify(sanitize(data, new Map()), reducers);
		} catch (e) {
			// Last resort (e.g. a throwing getter): still produce a valid message.
			const message = e instanceof Error ? e.message : String(e);
			return devalue.stringify(`[unserializable IPC payload: ${message}]`);
		}
	}
}

function deserialize(serialized: string): unknown {
	return devalue.parse(serialized, revivers);
}

function isErrorLike(value: object): value is { message: string; name?: unknown; stack?: unknown } {
	return "message" in value && typeof (value as { message: unknown }).message === "string";
}

function isPlainObject(value: object): boolean {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Deep-converts a value into one devalue can stringify: class instances become
 * plain objects, error-likes become real Errors, and values devalue rejects
 * outright (functions, symbols, promises) become placeholder strings.
 * `seen` preserves cycles and repeated references.
 */
function sanitize(value: unknown, seen: Map<unknown, unknown>): unknown {
	if (typeof value === "function") {
		return `[function ${value.name || "anonymous"}]`;
	}
	if (typeof value === "symbol") {
		return value.toString();
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	if (seen.has(value)) {
		return seen.get(value);
	}

	if (value instanceof Error) {
		const error = new Error(value.message);
		seen.set(value, error);
		error.name = value.name;
		error.stack = value.stack;
		if (value.cause !== undefined) {
			error.cause = sanitize(value.cause, seen);
		}
		return error;
	}

	if (typeof (value as { then?: unknown }).then === "function") {
		return "[promise]";
	}

	if (
		value instanceof Date ||
		value instanceof RegExp ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	) {
		return value;
	}

	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(value, result);
		for (const item of value) {
			result.push(sanitize(item, seen));
		}
		return result;
	}

	if (value instanceof Map) {
		const result = new Map<unknown, unknown>();
		seen.set(value, result);
		for (const [key, entry] of value) {
			result.set(sanitize(key, seen), sanitize(entry, seen));
		}
		return result;
	}

	if (value instanceof Set) {
		const result = new Set<unknown>();
		seen.set(value, result);
		for (const item of value) {
			result.add(sanitize(item, seen));
		}
		return result;
	}

	// Error-like class instances that don't extend Error (e.g. AirtableError)
	// are promoted to real Errors so they roundtrip as Errors on the far side.
	if (!isPlainObject(value) && isErrorLike(value)) {
		const error = new Error(value.message);
		seen.set(value, error);
		error.name = typeof value.name === "string" ? value.name : (value.constructor?.name ?? "Error");
		if (typeof value.stack === "string") {
			error.stack = value.stack;
		}
		return error;
	}

	// POJOs are rebuilt because their values may need sanitizing; any other
	// class instance is flattened to a POJO of its own enumerable properties.
	const result: Record<string, unknown> = {};
	seen.set(value, result);
	for (const [key, entry] of Object.entries(value)) {
		result[key] = sanitize(entry, seen);
	}
	return result;
}

export const IPCSerializer = {
	serialize,
	deserialize,
};
