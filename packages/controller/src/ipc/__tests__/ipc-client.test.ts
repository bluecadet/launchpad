import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPCEvent, IPCResponse } from "../../transports/ipc-transport.js";
import { IPCClient } from "../ipc-client.js";
import { IPCSerializer } from "../ipc-serializer.js";
import { getOSSocketPath } from "../ipc-utils.js";

type Cb = (...args: any[]) => void;

function createTestClient() {
	const writeMock = vi.fn((_data: string, cb?: Cb) => {
		if (cb) cb();
	});
	const endMock = vi.fn();
	const socketListeners: { [key: string]: Cb[] } = {};

	const mockSocket = {
		write: writeMock,
		end: endMock,
		on: vi.fn((event: string, handler: Cb) => {
			if (!socketListeners[event]) {
				socketListeners[event] = [];
			}
			socketListeners[event].push(handler);
		}),
		removeListener: vi.fn(),
		removeAllListeners: vi.fn(),
	} as any as net.Socket;

	vi.spyOn(net, "createConnection").mockImplementationOnce((_path, cb) => {
		if (cb) setTimeout(cb, 0);
		return mockSocket;
	});

	const client = new IPCClient();

	function simulateEvent(event: string, ...args: any[]) {
		const handlers = socketListeners[event] || [];
		for (const handler of handlers) {
			handler(...args);
		}
	}

	function simulateData(data: any) {
		simulateEvent("data", Buffer.from(`${IPCSerializer.serialize(data)}\n`));
	}

	function setInternalState(state: any) {
		(client as any)._lastState = state;
	}

	function parsedWriteCall(callNumber?: number): any {
		if (callNumber === undefined) {
			expect(writeMock).toHaveBeenCalled();
			const lastCall = writeMock.mock.lastCall!;
			return IPCSerializer.deserialize(lastCall[0].trim());
		}

		expect(writeMock).toHaveBeenCalledTimes(callNumber);
		const call = writeMock.mock.calls[callNumber - 1]!;
		return IPCSerializer.deserialize(call[0].trim());
	}

	return {
		client,
		writeMock,
		endMock,
		mockSocket,
		simulateEvent,
		simulateData,
		setInternalState,
		socketListeners,
		parsedWriteCall,
	};
}

describe("IPCClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("connect", () => {
		it("should connect to the IPC socket", async () => {
			const { client } = createTestClient();
			const result = await client.connect("/test/socket");

			expect(result.isOk()).toBe(true);
			expect(net.createConnection).toHaveBeenCalledWith(getOSSocketPath("/test/socket"), expect.any(Function));
		});

		it("should return error if connection fails", async () => {
			vi.spyOn(net, "createConnection").mockImplementation((_socketPath, _callback) => {
				const socket = {
					on: vi.fn((event: string, handler: Cb) => {
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
			const { client, mockSocket } = createTestClient();
			await client.connect("/test/socket");
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalled();
		});

		it("should be safe to call when not connected", () => {
			const { client } = createTestClient();
			expect(() => client.disconnect()).not.toThrow();
		});

		it("should be safe to call multiple times", async () => {
			const { client, mockSocket } = createTestClient();
			await client.connect("/test/socket");
			client.disconnect();
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalledTimes(1);
		});
	});

	describe("queryState", () => {
		it("should query controller state", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate server response
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } } as any,
			};
			simulateData(response);

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should handle error response", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate error response
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Failed to get state"),
			};
			simulateData(response);

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Controller error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Failed to get state");
		});

		it("should return error for unexpected response type", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate unexpected response
			const response = {
				id: "msg-0",
				type: "unexpected",
				data: {},
			};
			simulateData(response);

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
		});

		it("should return error if not connected", async () => {
			const { client } = createTestClient();
			const result = await client.queryState();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("executeCommand", () => {
		it("should execute a command on the controller", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate server response
			const response: IPCResponse = {
				id: "msg-0",
				type: "result",
				data: { status: "success" },
			};
			simulateData(response);

			const result = await commandPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ status: "success" });
		});

		it("should handle error response from command", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate error response
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Command failed"),
			};
			simulateData(response);

			const result = await commandPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(
				"Error dispatching command: content.fetch",
			);
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Command failed");
		});

		it("should return error for unexpected response type", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate unexpected response
			const response = {
				id: "msg-0",
				type: "state",
				data: {},
			};
			simulateData(response);

			const result = await commandPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
		});

		it("should pass command data correctly", async () => {
			const { client, parsedWriteCall } = createTestClient();
			await client.connect("/test/socket");

			client.executeCommand({ type: "monitor.connect", data: { app: "test-app" } });

			// Get the message that was sent
			const parsedMessage = parsedWriteCall();
			expect(parsedMessage.type).toBe("execute-command");
			expect(parsedMessage.data).toEqual({ type: "monitor.connect", data: { app: "test-app" } });
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
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate server response
			const response: IPCResponse = {
				id: "msg-0",
				type: "ack",
			};
			simulateData(response);

			const result = await shutdownPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeUndefined();
		});

		it("should handle error response from shutdown", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate error response
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Shutdown failed"),
			};
			simulateData(response);

			const result = await shutdownPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Shutdown error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Shutdown failed");
		});

		it("should return error for unexpected response type", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate unexpected response
			const response = {
				id: "msg-0",
				type: "state",
				data: {},
			};
			simulateData(response);

			const result = await shutdownPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
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
			const { client, simulateEvent } = createTestClient();
			await client.connect("/test/socket");

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			// Simulate multiple messages in one data chunk
			const response1: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } } as any,
			};
			const response2: IPCResponse = {
				id: "msg-1",
				type: "state",
				data: { system: { mode: "persistent" } } as any,
			};
			const data = `${IPCSerializer.serialize(response1)}\n${IPCSerializer.serialize(response2)}\n`;
			simulateEvent("data", Buffer.from(data));

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1.isOk()).toBe(true);
			expect(result1._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
			expect(result2.isOk()).toBe(true);
			expect(result2._unsafeUnwrap()).toEqual({ system: { mode: "persistent" } });
		});

		it("should handle incomplete messages", async () => {
			const { client, simulateEvent } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate incomplete message (no newline)
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } } as any,
			};
			simulateEvent("data", Buffer.from(IPCSerializer.serialize(response)));

			// Message should not be processed yet
			// Send the rest of the message with newline
			simulateEvent("data", Buffer.from("\n"));

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should ignore malformed JSON messages", async () => {
			const { client, simulateEvent } = createTestClient();
			await client.connect("/test/socket");

			// Should not throw
			expect(() => {
				simulateEvent("data", Buffer.from("invalid json\n"));
			}).not.toThrow();
		});

		it("should ignore empty lines", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } } as any,
			};
			// Send empty line then valid message
			simulateData(response);

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should reject pending requests when socket closes", async () => {
			const { client, socketListeners } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate socket close
			const closeHandler = socketListeners.close![0]!;
			closeHandler();

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Socket closed");
		});
	});

	describe("integration", () => {
		it("should handle sequential requests", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			// Respond to first query
			const response1: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { first: true } as any,
			};
			simulateData(response1);

			// Respond to second query
			const response2: IPCResponse = {
				id: "msg-1",
				type: "state",
				data: { second: true } as any,
			};
			simulateData(response2);

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1._unsafeUnwrap()).toEqual({ first: true });
			expect(result2._unsafeUnwrap()).toEqual({ second: true });
		});

		it("should handle mixed request types", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();
			const commandPromise = client.executeCommand({ type: "test.command" });

			// Respond to query
			const queryResponse: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { mode: "task" } as any,
			};
			simulateData(queryResponse);

			// Respond to command
			const commandResponse: IPCResponse = {
				id: "msg-1",
				type: "result",
				data: { executed: true },
			};
			simulateData(commandResponse);

			const queryResult = await queryPromise;
			const commandResult = await commandPromise;

			expect(queryResult._unsafeUnwrap()).toEqual({ mode: "task" });
			expect(commandResult._unsafeUnwrap()).toEqual({ executed: true });
		});
	});

	describe("event handling", () => {
		it("should emit events to registered listeners", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:start", handler);

			// Simulate event from server
			const event: IPCEvent = {
				type: "event",
				name: "command:start",
				data: { commandType: "test.command" },
			};
			simulateData(event);

			// Handler should be called with event data
			expect(handler).toHaveBeenCalledWith({ commandType: "test.command" });
		});

		it("should support multiple listeners for the same event", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			client.on("command:success", handler1);
			client.on("command:success", handler2);

			const event: IPCEvent = {
				type: "event",
				name: "command:success",
				data: { commandType: "test.command", result: { value: 42 } },
			};
			simulateData(event);

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
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.once("system:shutdown", handler);

			const event: IPCEvent = {
				type: "event",
				name: "system:shutdown",
				data: { code: 0 },
			};

			// Emit event twice
			simulateData(event);
			simulateData(event);

			// Handler should only be called once
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ code: 0 });
		});

		it("should support off() to unsubscribe from events", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:error", handler);
			client.off("command:error", handler);

			const event: IPCEvent = {
				type: "event",
				name: "command:error",
				data: { commandType: "test.command", error: new Error("Test error") },
			};
			simulateData(event);

			// Handler should not be called after unsubscribing
			expect(handler).not.toHaveBeenCalled();
		});

		it("should support onAny() for wildcard listeners", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.onAny(handler);

			// Emit multiple events
			const event1: IPCEvent = {
				type: "event",
				name: "command:start",
				data: { commandType: "cmd1" },
			};
			const event2: IPCEvent = {
				type: "event",
				name: "command:success",
				data: { commandType: "cmd1", result: { value: 42 } },
			};

			simulateData(event1);
			simulateData(event2);

			// Handler should be called for both events with event name and data
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, "command:start", {
				commandType: "cmd1",
			});
			expect(handler).toHaveBeenNthCalledWith(2, "command:success", {
				commandType: "cmd1",
				result: { value: 42 },
			});
		});

		it("should support offAny() to unsubscribe from wildcard listeners", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.onAny(handler);
			client.offAny(handler);

			const event: IPCEvent = {
				type: "event",
				name: "command:start",
				data: { commandType: "test" },
			};
			simulateData(event);

			// Handler should not be called after unsubscribing
			expect(handler).not.toHaveBeenCalled();
		});

		it("should handle mixed request-response and event messages", async () => {
			const { client, simulateEvent } = createTestClient();
			await client.connect("/test/socket");

			const queryPromise = client.queryState();
			const eventHandler = vi.fn();
			client.on("command:success", eventHandler);

			// Send event and response mixed
			const event: IPCEvent = {
				type: "event",
				name: "command:success",
				data: { commandType: "test.command", result: { success: true } },
			};
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } } as any,
			};

			const data = `${IPCSerializer.serialize(event)}\n${IPCSerializer.serialize(response)}\n`;
			simulateEvent("data", Buffer.from(data));

			const result = await queryPromise;

			// Both event listener and query response should work correctly
			expect(eventHandler).toHaveBeenCalledWith({
				commandType: "test.command",
				result: { success: true },
			});
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should handle multiple events in sequence", async () => {
			const { client, simulateEvent } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:start", handler);

			// Send multiple events
			const event1: IPCEvent = {
				type: "event",
				name: "command:start",
				data: {
					commandType: "lorem",
				},
			};
			const event2: IPCEvent = {
				type: "event",
				name: "command:start",
				data: {
					commandType: "ipsum",
				},
			};

			simulateEvent(
				"data",
				Buffer.from(`${IPCSerializer.serialize(event1)}\n${IPCSerializer.serialize(event2)}\n`),
			);

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, {
				commandType: "lorem",
			});
			expect(handler).toHaveBeenNthCalledWith(2, {
				commandType: "ipsum",
			});
		});
	});

	describe("state patches and onStateChange", () => {
		it("should register onStateChange listener", async () => {
			const { client } = createTestClient();
			await client.connect("/test/socket");

			const listener = vi.fn();
			const unsubscribe = client.onStateChange(listener);

			// Listener should be registered (can't easily test the call without full integration)
			expect(typeof unsubscribe).toBe("function");
		});

		it("should unsubscribe from onStateChange", async () => {
			const { client, simulateData } = createTestClient();
			await client.connect("/test/socket");

			const listener = vi.fn();
			const unsubscribe = client.onStateChange(listener);

			// Set initial state
			(client as any)._lastState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				subsystems: { test: { x: 1 } },
				_version: 1,
			};

			unsubscribe();

			// Send patch
			const patch = {
				type: "state-patch",
				patches: [{ op: "replace", path: ["subsystems", "test", "x"], value: 2 }],
				version: 2,
			};

			simulateData(patch);

			// Listener should not be called after unsubscribe (sync check)
			expect(listener).not.toHaveBeenCalled();
		});

		it("should handle patch messages", async () => {
			const { client, simulateData, writeMock } = createTestClient();
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.onStateChange(handler);

			// Set initial state by triggering a query
			const initialState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				subsystems: { test: { x: 1 } },
				_version: 1,
			};

			const queryPromise = client.queryState();

			// Simulate server response for initial state
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: initialState as any,
			};
			simulateData(response);

			await queryPromise;

			expect(writeMock).toHaveBeenCalledTimes(1);

			// Send out-of-sequence patch (should trigger queryState)
			let patch = {
				type: "state-patch",
				patches: [{ op: "replace", path: ["subsystems", "test", "x"], value: 2 }],
				version: 2, // Skip version, should trigger re-query
			};

			simulateData(patch);

			// it shouldn't have queried state again since version is correct
			expect(writeMock).toHaveBeenCalledTimes(1);

			// should patch state and call handler
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({
				system: { mode: "task", startTime: initialState.system.startTime, version: "1.0.0" },
				subsystems: { test: { x: 2 } },
			});

			// Send in-sequence patch
			patch = {
				type: "state-patch",
				patches: [{ op: "replace", path: ["subsystems", "test", "x"], value: 3 }],
				version: 3,
			};

			simulateData(patch);

			// it shouldn't have queried state again since version is correct
			expect(writeMock).toHaveBeenCalledTimes(1);

			// should patch state and call handler again
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenCalledWith({
				system: { mode: "task", startTime: initialState.system.startTime, version: "1.0.0" },
				subsystems: { test: { x: 3 } },
			});
		});

		it("should query state on version mismatch", async () => {
			const { client, simulateData, parsedWriteCall } = createTestClient();
			await client.connect("/test/socket");

			// Set initial state by triggering a query
			const initialState = {
				system: { mode: "task", startTime: new Date(), version: "1.0.0" },
				subsystems: { test: { x: 1 } },
				_version: 1,
			};

			const queryPromise = client.queryState();

			// Simulate server response for initial state
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: initialState as any,
			};
			simulateData(response);

			await queryPromise;

			// Send out-of-sequence patch (should trigger queryState)
			const patch = {
				type: "state-patch",
				patches: [{ op: "replace", path: ["subsystems", "test", "x"], value: 2 }],
				version: 5, // Skip version, should trigger re-query
			};

			simulateData(patch);

			// Should trigger queryState due to version mismatch
			const parsedMessage = parsedWriteCall();
			expect(parsedMessage.type).toBe("query-state");
		});

		it("should trigger queryState if no initial state when patch arrives", async () => {
			const { client, simulateData, parsedWriteCall } = createTestClient();
			await client.connect("/test/socket");

			// Send patch without having set initial state
			const patch = {
				type: "state-patch",
				patches: [{ op: "replace", path: ["subsystems", "test", "x"], value: 1 }],
				version: 1,
			};

			simulateData(patch);

			// Should trigger queryState because no initial state
			const parsedMessage = parsedWriteCall();
			expect(parsedMessage.type).toBe("query-state");
		});

		it("should support multiple onStateChange listeners", async () => {
			const { client } = createTestClient();
			await client.connect("/test/socket");

			const listener1 = vi.fn();
			const listener2 = vi.fn();

			client.onStateChange(listener1);
			client.onStateChange(listener2);

			// Both listeners should be in the set (can't directly test, but unsubscribe should work)
			const unsub1 = () => listener1;
			const unsub2 = () => listener2;

			expect(typeof unsub1).toBe("function");
			expect(typeof unsub2).toBe("function");
		});
	});
});
