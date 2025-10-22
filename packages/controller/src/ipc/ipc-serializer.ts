/**
 * Wraps SuperJSON serialization for IPC messages.
 */

import * as devalue from "devalue";

type ErrorObj = {
	name: string;
	message: string;
	stack?: string;
	cause?: unknown;
};

function errToObj(error: Error): ErrorObj {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		cause: error.cause instanceof Error ? errToObj(error.cause) : error.cause,
	};
}

function objToErr(obj: ErrorObj): Error {
	const error = new Error(obj.message);
	error.name = obj.name;
	error.stack = obj.stack;
	if (obj.cause) {
		if (typeof obj.cause === "object" && "name" in obj.cause && "message" in obj.cause) {
			error.cause = objToErr(obj.cause as ErrorObj);
		} else {
			error.cause = obj.cause as Error;
		}
	}
	return error;
}

function serialize(data: unknown): string {
	return devalue.stringify(data, {
		Error: (value) => value instanceof Error && errToObj(value),
	});
}

function deserialize(serialized: string): unknown {
	return devalue.parse(serialized, {
		Error: (value) => objToErr(value),
	});
}

export const IPCSerializer = {
	serialize,
	deserialize,
};
