import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { createEmptyState } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestIPCServer } from "./helpers/socket-server.js";
import { createTestIPCServer } from "./helpers/socket-server.js";

function makeStateHandler(): import("./helpers/socket-server.js").RequestHandler {
	const state = createEmptyState();
	return (msg) => {
		const { id } = msg;
		if (msg.type === "query-state") return { id, type: "state", data: state };
		if (msg.type === "execute-command") return { id, type: "result", data: null };
		if (msg.type === "shutdown") return { id, type: "ack" };
		return { id, type: "error", error: new Error("unhandled") };
	};
}

describe("IPC round-trip", () => {
	let server: TestIPCServer;
	let client: IPCClient;

	beforeAll(async () => {
		server = await createTestIPCServer(makeStateHandler());

		client = new IPCClient();
		const connectResult = await client.connect(server.socketPath);
		expect(connectResult.isOk()).toBe(true);
	});

	afterAll(async () => {
		client.disconnect();
		await server.close();
	});

	it("queryState() returns the state from server", async () => {
		const result = await client.queryState();
		expect(result.isOk()).toBe(true);
	});

	it("executeCommand() returns a result", async () => {
		const result = await client.executeCommand({ type: "content.fetch" });
		expect(result.isOk()).toBe(true);
	});

	it("shutdown() returns ack", async () => {
		const result = await client.shutdown();
		expect(result.isOk()).toBe(true);
	});

	it("server received all messages", () => {
		const messages = server.getReceivedMessages();
		expect(messages).toHaveLength(3);
		expect(messages.map((m) => m.type)).toEqual(["query-state", "execute-command", "shutdown"]);
	});
});

describe("concurrent IPC clients", () => {
	let server: TestIPCServer;

	beforeAll(async () => {
		server = await createTestIPCServer(makeStateHandler());
	});

	afterAll(async () => {
		await server.close();
	});

	it("handles multiple simultaneous connections and interleaved requests", async () => {
		const clients = await Promise.all(
			[0, 1, 2].map(async () => {
				const c = new IPCClient();
				const r = await c.connect(server.socketPath);
				expect(r.isOk()).toBe(true);
				return c;
			}),
		);

		// Fire all requests at the same time across all three clients.
		const results = await Promise.all(clients.map((c) => c.queryState()));

		for (const result of results) {
			expect(result.isOk()).toBe(true);
		}

		for (const c of clients) {
			c.disconnect();
		}
	});
});
