import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import { createEmptyState } from "@bluecadet/launchpad-testing/test-utils.ts";
import { err, errAsync, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DaemonNotRunningError,
	type IPCConnectionError,
	withDaemon,
} from "../utils/controller-execution.js";
import type { TestIPCServer } from "./helpers/socket-server.js";
import { createTestIPCServer } from "./helpers/socket-server.js";

function makeConfig(socketPath: string) {
	return controllerConfigSchema.parse({ socketPath, pidFile: "irrelevant.pid" });
}

function makeStateHandler() {
	const state = createEmptyState();
	return (msg: import("./helpers/socket-server.js").IPCMessage) => {
		const { id } = msg;
		if (msg.type === "query-state") return { id, type: "state" as const, data: state };
		if (msg.type === "shutdown") return { id, type: "ack" as const };
		if (msg.type === "execute-command") return { id, type: "result" as const, data: null };
		return { id, type: "ack" as const };
	};
}

describe("withDaemon — real socket integration", () => {
	let server: TestIPCServer;

	beforeEach(async () => {
		server = await createTestIPCServer(makeStateHandler());
	});

	afterEach(async () => {
		await server.close();
	});

	// Injects our own PID — the test process is always running
	const runningPid = () => ok(process.pid);

	it("connects real IPCClient to socket and returns operation result", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client) => client.queryState(),
			{ resolvePid: runningPid },
		);

		expect(result.isOk()).toBe(true);
	});

	it("passes the resolved pid to the operation", async () => {
		let capturedPid: number | undefined;

		await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client, pid) => {
				capturedPid = pid;
				return client.queryState();
			},
			{ resolvePid: runningPid },
		);

		expect(capturedPid).toBe(process.pid);
	});

	it("sends shutdown message and receives ack", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client) => client.shutdown(),
			{ resolvePid: runningPid },
		);

		expect(result.isOk()).toBe(true);
		expect(server.getReceivedMessages().at(-1)?.type).toBe("shutdown");
	});

	it("propagates errors returned by the operation", async () => {
		const boom = new Error("op failed");

		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			() => errAsync(boom as IPCConnectionError),
			{ resolvePid: runningPid },
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(boom);
	});

	it("returns DaemonNotRunningError when resolvePid returns null", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client) => client.queryState(),
			{ resolvePid: () => ok(null) },
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(DaemonNotRunningError);
	});

	it("returns DaemonNotRunningError when resolvePid returns Err", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client) => client.queryState(),
			{ resolvePid: () => err(new Error("pid read failed")) },
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(DaemonNotRunningError);
	});

	it("returns error when socket path does not exist", async () => {
		const result = await withDaemon(
			"/",
			makeConfig("/tmp/no-such-socket-lp-test.sock"),
			false,
			(client) => client.queryState(),
			{ resolvePid: runningPid },
		);

		expect(result.isErr()).toBe(true);
	});

	it("relayLogs: true — operation still succeeds", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			true,
			(client) => client.queryState(),
			{ resolvePid: runningPid },
		);

		expect(result.isOk()).toBe(true);
	});

	it("queryState returns the state provided by the server", async () => {
		const result = await withDaemon(
			"/",
			makeConfig(server.socketPath),
			false,
			(client) => client.queryState(),
			{ resolvePid: runningPid },
		);

		expect(result.isOk()).toBe(true);
		const state = result._unsafeUnwrap();
		expect(state).toMatchObject({
			system: expect.objectContaining({ mode: expect.any(String) }),
			plugins: expect.any(Object),
		});
	});
});
