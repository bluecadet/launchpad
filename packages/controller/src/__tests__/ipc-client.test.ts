import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPCClient } from "../ipc-client.js";
import { IPCSerializer } from "../utils/ipc-serializer.js";
import { getOSSocketPath } from "../utils/ipc-utils.js";
import { createConnectedTestClient, createTestClient } from "./helpers.js";

describe("IPCClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("connect", () => {
		it("should connect to the IPC socket", async () => {
			const { client } = createTestClient();
			const result = await client.connect("/test/socket");

			expect(result.isOk()).toBe(true);
			expect(net.createConnection).toHaveBeenCalledWith(
				getOSSocketPath("/test/socket"),
				expect.any(Function),
			);
		});

		it("should return error if connection fails", async () => {
			vi.spyOn(net, "createConnection").mockImplementation((_socketPath, _callback) => {
				const socket = {
					on: vi.fn((event: string, handler: (...args: any[]) => void) => {
						if (event === "error") {
							setTimeout(() => handler(new Error("Connection refused")), 0);
						}
					}),
				};
				return socket as any;
			});

			const client = new IPCClient();
			const result = await client.connect("/test/socket");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("IPC connection failed");
		});
	});

	describe("disconnect", () => {
		it("should disconnect from the socket", async () => {
			const { client, mockSocket } = await createConnectedTestClient();
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalled();
		});

		it("should be safe to call when not connected", () => {
			const { client } = createTestClient();
			expect(() => client.disconnect()).not.toThrow();
		});

		it("should be safe to call multiple times", async () => {
			const { client, mockSocket } = await createConnectedTestClient();
			client.disconnect();
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalledTimes(1);
		});
	});

	describe("queryState", () => {
		it("should query controller state", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const queryPromise = client.queryState();

			simulateData({ jsonrpc: "2.0", id: 0, result: { system: { mode: "task" } } });

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should handle error response", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const queryPromise = client.queryState();

			const error = new Error("Failed to get state");
			simulateData({
				jsonrpc: "2.0",
				id: 0,
				error: { code: -32603, message: error.message, data: error },
			});

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Controller error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Failed to get state");
		});

		it("should return error if not connected", async () => {
			const { client } = createTestClient();
			const result = await client.queryState();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("executeCommand", () => {
		it("should send the command and return the result", async () => {
			const { client, simulateData, parsedWriteCall } = await createConnectedTestClient();

			const commandPromise = client.executeCommand({
				type: "monitor.connect",
				data: { app: "test-app" },
			} as any);

			const sentMessage = parsedWriteCall();
			expect(sentMessage.method).toBe("executeCommand");
			expect(sentMessage.params).toEqual({ type: "monitor.connect", data: { app: "test-app" } });

			simulateData({ jsonrpc: "2.0", id: 0, result: { status: "success" } });

			const result = await commandPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ status: "success" });
		});

		it("should handle error response from command", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			const error = new Error("Command failed");
			simulateData({
				jsonrpc: "2.0",
				id: 0,
				error: { code: -32603, message: error.message, data: error },
			});

			const result = await commandPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(
				"Error dispatching command: content.fetch",
			);
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Command failed");
		});

		it("should return error if not connected", async () => {
			const { client } = createTestClient();
			const result = await client.executeCommand({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("shutdown", () => {
		it("should send shutdown command to the controller", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const shutdownPromise = client.shutdown();

			simulateData({ jsonrpc: "2.0", id: 0, result: null });

			const result = await shutdownPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeUndefined();
		});

		it("should handle error response from shutdown", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const shutdownPromise = client.shutdown();

			const error = new Error("Shutdown failed");
			simulateData({
				jsonrpc: "2.0",
				id: 0,
				error: { code: -32603, message: error.message, data: error },
			});

			const result = await shutdownPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Shutdown error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Shutdown failed");
		});

		it("should return error if not connected", async () => {
			const { client } = createTestClient();
			const result = await client.shutdown();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("message handling", () => {
		it("should handle multiple messages in one data chunk", async () => {
			const { client, simulateEvent } = await createConnectedTestClient();

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			const response1 = { jsonrpc: "2.0", id: 0, result: { system: { mode: "task" } } };
			const response2 = { jsonrpc: "2.0", id: 1, result: { system: { mode: "persistent" } } };
			const data = `${IPCSerializer.serialize(response1)}\n${IPCSerializer.serialize(response2)}\n`;
			simulateEvent("data", Buffer.from(data));

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1.isOk()).toBe(true);
			expect(result1._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
			expect(result2.isOk()).toBe(true);
			expect(result2._unsafeUnwrap()).toEqual({ system: { mode: "persistent" } });
		});

		it("should handle incomplete messages split across chunks", async () => {
			const { client, simulateEvent } = await createConnectedTestClient();

			const queryPromise = client.queryState();

			const response = { jsonrpc: "2.0", id: 0, result: { system: { mode: "task" } } };
			simulateEvent("data", Buffer.from(IPCSerializer.serialize(response)));

			// Message should not be processed yet — send the terminating newline
			simulateEvent("data", Buffer.from("\n"));

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should ignore malformed JSON messages", async () => {
			const { simulateEvent } = await createConnectedTestClient();

			expect(() => {
				simulateEvent("data", Buffer.from("invalid json\n"));
			}).not.toThrow();
		});

		it("should reject pending requests when socket closes", async () => {
			const { client, socketListeners } = await createConnectedTestClient();

			const queryPromise = client.queryState();

			const closeHandler = socketListeners.close![0]!;
			closeHandler();

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Socket closed");
		});
	});

	describe("integration", () => {
		it("should correlate sequential requests to their responses by ID", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			simulateData({ jsonrpc: "2.0", id: 0, result: { first: true } });
			simulateData({ jsonrpc: "2.0", id: 1, result: { second: true } });

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1._unsafeUnwrap()).toEqual({ first: true });
			expect(result2._unsafeUnwrap()).toEqual({ second: true });
		});

		it("should handle mixed request types in flight simultaneously", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const queryPromise = client.queryState();
			const commandPromise = client.executeCommand({ type: "test.command" });

			simulateData({ jsonrpc: "2.0", id: 0, result: { mode: "task" } });
			simulateData({ jsonrpc: "2.0", id: 1, result: { executed: true } });

			const queryResult = await queryPromise;
			const commandResult = await commandPromise;

			expect(queryResult._unsafeUnwrap()).toEqual({ mode: "task" });
			expect(commandResult._unsafeUnwrap()).toEqual({ executed: true });
		});
	});

	describe("event handling", () => {
		it("should emit events to registered listeners", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler = vi.fn();
			client.on("command:start", handler);

			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:start", data: { commandType: "test.command" } },
			});

			expect(handler).toHaveBeenCalledWith({ commandType: "test.command" });
		});

		it("should support multiple listeners for the same event", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			client.on("command:success", handler1);
			client.on("command:success", handler2);

			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: {
					name: "command:success",
					data: { commandType: "test.command", result: { value: 42 } },
				},
			});

			expect(handler1).toHaveBeenCalledWith({
				commandType: "test.command",
				result: { value: 42 },
			});
			expect(handler2).toHaveBeenCalledWith({
				commandType: "test.command",
				result: { value: 42 },
			});
		});

		it("should support once() for single-fire listeners", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler = vi.fn();
			client.once("system:shutdown", handler);

			const event = {
				jsonrpc: "2.0",
				method: "event",
				params: { name: "system:shutdown", data: { code: 0 } },
			};

			simulateData(event);
			simulateData(event);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ code: 0 });
		});

		it("should support off() to unsubscribe from events", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler = vi.fn();
			client.on("command:error", handler);
			client.off("command:error", handler);

			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: {
					name: "command:error",
					data: { commandType: "test.command", error: new Error("Test error") },
				},
			});

			expect(handler).not.toHaveBeenCalled();
		});

		it("should support onAny() for wildcard listeners", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler = vi.fn();
			client.onAny(handler);

			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:start", data: { commandType: "cmd1" } },
			});
			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:success", data: { commandType: "cmd1", result: { value: 42 } } },
			});

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, "command:start", { commandType: "cmd1" });
			expect(handler).toHaveBeenNthCalledWith(2, "command:success", {
				commandType: "cmd1",
				result: { value: 42 },
			});
		});

		it("should support offAny() to unsubscribe from wildcard listeners", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const handler = vi.fn();
			client.onAny(handler);
			client.offAny(handler);

			simulateData({
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:start", data: { commandType: "test" } },
			});

			expect(handler).not.toHaveBeenCalled();
		});

		it("should handle mixed request-response and event messages", async () => {
			const { client, simulateEvent } = await createConnectedTestClient();

			const queryPromise = client.queryState();
			const eventHandler = vi.fn();
			client.on("command:success", eventHandler);

			const event = {
				jsonrpc: "2.0",
				method: "event",
				params: {
					name: "command:success",
					data: { commandType: "test.command", result: { success: true } },
				},
			};
			const response = { jsonrpc: "2.0", id: 0, result: { system: { mode: "task" } } };

			const data = `${IPCSerializer.serialize(event)}\n${IPCSerializer.serialize(response)}\n`;
			simulateEvent("data", Buffer.from(data));

			const result = await queryPromise;

			expect(eventHandler).toHaveBeenCalledWith({
				commandType: "test.command",
				result: { success: true },
			});
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should handle multiple events in sequence", async () => {
			const { client, simulateEvent } = await createConnectedTestClient();

			const handler = vi.fn();
			client.on("command:start", handler);

			const event1 = {
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:start", data: { commandType: "lorem" } },
			};
			const event2 = {
				jsonrpc: "2.0",
				method: "event",
				params: { name: "command:start", data: { commandType: "ipsum" } },
			};

			simulateEvent(
				"data",
				Buffer.from(`${IPCSerializer.serialize(event1)}\n${IPCSerializer.serialize(event2)}\n`),
			);

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, { commandType: "lorem" });
			expect(handler).toHaveBeenNthCalledWith(2, { commandType: "ipsum" });
		});
	});

	describe("state patches and onStateChange", () => {
		it("should register onStateChange listener and return unsubscribe function", async () => {
			const { client } = await createConnectedTestClient();

			const listener = vi.fn();
			const unsubscribe = client.onStateChange(listener);

			expect(typeof unsubscribe).toBe("function");
		});

		it("should not call listener after unsubscribe", async () => {
			const { client, simulateData } = await createConnectedTestClient();

			const listener = vi.fn();
			const unsubscribe = client.onStateChange(listener);

			(client as any)._lastState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				plugins: { test: { x: 1 } },
				_version: 1,
			};

			unsubscribe();

			simulateData({
				jsonrpc: "2.0",
				method: "statePatch",
				params: {
					patches: [{ op: "replace", path: ["plugins", "test", "x"], value: 2 }],
					version: 2,
				},
			});

			expect(listener).not.toHaveBeenCalled();
		});

		it("should apply patches and call onStateChange listeners", async () => {
			const { client, simulateData, writeMock } = await createConnectedTestClient();

			const handler = vi.fn();
			client.onStateChange(handler);

			const initialState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				plugins: { test: { x: 1 } },
				_version: 1,
			};

			const queryPromise = client.queryState();

			simulateData({ jsonrpc: "2.0", id: 0, result: initialState as any });

			await queryPromise;

			expect(writeMock).toHaveBeenCalledTimes(1);

			// In-sequence patch (version 1 → 2)
			simulateData({
				jsonrpc: "2.0",
				method: "statePatch",
				params: {
					patches: [{ op: "replace", path: ["plugins", "test", "x"], value: 2 }],
					version: 2,
				},
			});

			expect(writeMock).toHaveBeenCalledTimes(1); // no re-query needed
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({
				system: { mode: "task", startTime: initialState.system.startTime, version: "1.0.0" },
				plugins: { test: { x: 2 } },
			});

			// Next in-sequence patch (version 2 → 3)
			simulateData({
				jsonrpc: "2.0",
				method: "statePatch",
				params: {
					patches: [{ op: "replace", path: ["plugins", "test", "x"], value: 3 }],
					version: 3,
				},
			});

			expect(writeMock).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenCalledWith({
				system: { mode: "task", startTime: initialState.system.startTime, version: "1.0.0" },
				plugins: { test: { x: 3 } },
			});
		});

		it("should query state on version mismatch", async () => {
			const { client, simulateData, parsedWriteCall } = await createConnectedTestClient();

			const initialState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				plugins: { test: { x: 1 } },
				_version: 1,
			};

			const queryPromise = client.queryState();

			simulateData({ jsonrpc: "2.0", id: 0, result: initialState as any });

			await queryPromise;

			// Out-of-sequence patch — should trigger a re-query
			simulateData({
				jsonrpc: "2.0",
				method: "statePatch",
				params: {
					patches: [{ op: "replace", path: ["plugins", "test", "x"], value: 2 }],
					version: 5,
				},
			});

			const parsedMessage = parsedWriteCall();
			expect(parsedMessage.method).toBe("queryState");
		});

		it("should trigger queryState if no initial state when patch arrives", async () => {
			const { simulateData, parsedWriteCall } = await createConnectedTestClient();

			simulateData({
				jsonrpc: "2.0",
				method: "statePatch",
				params: {
					patches: [{ op: "replace", path: ["plugins", "test", "x"], value: 1 }],
					version: 1,
				},
			});

			const parsedMessage = parsedWriteCall();
			expect(parsedMessage.method).toBe("queryState");
		});
	});
});
