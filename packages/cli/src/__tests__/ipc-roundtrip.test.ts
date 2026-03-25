// These vi.unmock calls are hoisted by Vitest before any imports.
// They override the global memfs mocks from setup.ts so integration tests
// use the real filesystem.
vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { createEmptyState } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestIPCServer } from "./helpers/socket-server.js";
import { createTestIPCServer } from "./helpers/socket-server.js";

describe("IPC round-trip", () => {
	let server: TestIPCServer;
	let client: IPCClient;

	beforeAll(async () => {
		const state = createEmptyState();

		server = await createTestIPCServer((msg) => {
			if (msg.type === "query-state") {
				return { id: msg.id, type: "state", data: state };
			}
			if (msg.type === "execute-command") {
				return { id: msg.id, type: "result", data: null };
			}
			if (msg.type === "shutdown") {
				return { id: msg.id, type: "ack" };
			}
			return { id: (msg as { id: string }).id, type: "error", error: new Error("unhandled") };
		});

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
