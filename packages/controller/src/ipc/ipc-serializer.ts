/**
 * Wraps SuperJSON serialization for IPC messages.
 */

import SuperJSON from "superjson";

function serialize(data: unknown): string {
	return SuperJSON.stringify(data);
}

function deserialize(serialized: string): unknown {
	return SuperJSON.parse(serialized);
}

export const IPCSerializer = {
	serialize,
	deserialize,
};
