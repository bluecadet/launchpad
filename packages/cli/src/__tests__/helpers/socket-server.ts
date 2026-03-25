import net from "node:net";
import os from "node:os";
import path from "node:path";
import * as devalue from "devalue";

// Inline the types from ipc-transport.ts (not directly exported by the package)
export type IPCMessage =
	| { type: "query-state"; id: string }
	| { type: "shutdown"; id: string }
	| { type: "execute-command"; id: string; data: unknown };

export type IPCResponse =
	| { id: string; type: "state"; data: unknown }
	| { id: string; type: "ack" }
	| { id: string; type: "result"; data: unknown }
	| { id: string; type: "error"; error: Error };

type ErrorObj = {
	name: string;
	message: string;
	stack?: string;
};

function objToErr(obj: ErrorObj): Error {
	const error = new Error(obj.message);
	error.name = obj.name;
	error.stack = obj.stack;
	return error;
}

function serialize(data: unknown): string {
	return devalue.stringify(data, {
		Error: (value) =>
			value instanceof Error && {
				name: value.name,
				message: value.message,
				stack: value.stack,
			},
	});
}

function deserialize(serialized: string): unknown {
	return devalue.parse(serialized, {
		Error: (value) => objToErr(value as ErrorObj),
	});
}

export type RequestHandler = (msg: IPCMessage) => IPCResponse;

export type TestIPCServer = {
	socketPath: string;
	close: () => Promise<void>;
	getReceivedMessages: () => IPCMessage[];
};

export async function createTestIPCServer(handler: RequestHandler): Promise<TestIPCServer> {
	const socketPath = path.join(os.tmpdir(), `lp-test-${process.pid}-${Date.now()}.sock`);
	const received: IPCMessage[] = [];

	const server = net.createServer((socket) => {
		let buffer = "";
		socket.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const msg = deserialize(line) as IPCMessage;
				received.push(msg);
				const response = handler(msg);
				socket.write(`${serialize(response)}\n`);
			}
		});
	});

	await new Promise<void>((resolve) => server.listen(socketPath, resolve));

	return {
		socketPath,
		getReceivedMessages: () => received,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			),
	};
}
