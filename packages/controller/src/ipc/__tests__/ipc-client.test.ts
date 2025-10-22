import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPCEvent, IPCResponse } from "../../transports/ipc-transport.js";
import { IPCClient } from "../ipc-client.js";
import { IPCSerializer } from "../ipc-serializer.js";

type Cb = (...args: any[]) => void;

describe("IPCClient", () => {
	let client: IPCClient;
	let mockSocket: any;
	let socketListeners: { [key: string]: Cb[] };

	beforeEach(() => {
		client = new IPCClient();
		socketListeners = {};

		// Mock net.createConnection
		mockSocket = {
			write: vi.fn((_data: string, cb?: Cb) => {
				if (cb) cb();
			}),
			end: vi.fn(),
			on: vi.fn((event: string, handler: Cb) => {
				if (!socketListeners[event]) {
					socketListeners[event] = [];
				}
				socketListeners[event].push(handler);
			}),
			removeListener: vi.fn(),
			removeAllListeners: vi.fn(),
		};

		(vi.spyOn(net, "createConnection" as any) as any).mockImplementation(
			(_socketPath: string, callback: Cb | undefined) => {
				if (callback) {
					setTimeout(() => (callback as Cb)(), 0);
				}
				return mockSocket;
			},
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("connect", () => {
		it("should connect to the IPC socket", async () => {
			const result = await client.connect("/test/socket");

			expect(result.isOk()).toBe(true);
			expect(net.createConnection).toHaveBeenCalledWith("/test/socket", expect.any(Function));
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

			const result = await client.connect("/test/socket");

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("IPC connection failed");
		});

		it("should handle socket data events", async () => {
			await client.connect("/test/socket");

			const handlers = socketListeners.data || [];
			expect(handlers.length).toBeGreaterThan(0);
		});

		it("should handle socket close events", async () => {
			await client.connect("/test/socket");

			const handlers = socketListeners.close || [];
			expect(handlers.length).toBeGreaterThan(0);
		});

		it("should handle socket error events", async () => {
			await client.connect("/test/socket");

			const handlers = socketListeners.error || [];
			expect(handlers.length).toBeGreaterThan(0);
		});
	});

	describe("disconnect", () => {
		it("should disconnect from the socket", async () => {
			await client.connect("/test/socket");
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalled();
		});

		it("should be safe to call when not connected", () => {
			expect(() => client.disconnect()).not.toThrow();
		});

		it("should be safe to call multiple times", async () => {
			await client.connect("/test/socket");
			client.disconnect();
			client.disconnect();

			expect(mockSocket.end).toHaveBeenCalledTimes(1);
		});
	});

	describe("queryState", () => {
		it("should query controller state", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate server response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should handle error response", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate error response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Failed to get state"),
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Controller error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Failed to get state");
		});

		it("should return error for unexpected response type", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate unexpected response
			const dataHandler = socketListeners.data![0]!;
			const response = {
				id: "msg-0",
				type: "unexpected",
				data: {},
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await queryPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
		});

		it("should return error if not connected", async () => {
			const result = await client.queryState();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("executeCommand", () => {
		it("should execute a command on the controller", async () => {
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate server response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "result",
				data: { status: "success" },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await commandPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ status: "success" });
		});

		it("should handle error response from command", async () => {
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate error response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Command failed"),
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await commandPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(
				"Error dispatching command: content.fetch",
			);
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Command failed");
		});

		it("should return error for unexpected response type", async () => {
			await client.connect("/test/socket");

			const commandPromise = client.executeCommand({ type: "content.fetch" });

			// Simulate unexpected response
			const dataHandler = socketListeners.data![0]!;
			const response = {
				id: "msg-0",
				type: "state",
				data: {},
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await commandPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
		});

		it("should pass command data correctly", async () => {
			await client.connect("/test/socket");

			client.executeCommand({ type: "monitor.connect", data: { app: "test-app" } });

			// Get the message that was sent
			const sentMessage = mockSocket.write.mock.calls[0][0];
			const parsedMessage = IPCSerializer.deserialize(sentMessage.trim()) as any;

			expect(parsedMessage.type).toBe("execute-command");
			expect(parsedMessage.data).toEqual({ type: "monitor.connect", data: { app: "test-app" } });
		});

		it("should return error if not connected", async () => {
			const result = await client.executeCommand({ type: "content.fetch" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("shutdown", () => {
		it("should send shutdown command to the controller", async () => {
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate server response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "ack",
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await shutdownPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeUndefined();
		});

		it("should handle error response from shutdown", async () => {
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate error response
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "error",
				error: new Error("Shutdown failed"),
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await shutdownPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Shutdown error");
			expect(result._unsafeUnwrapErr().cause!.message).toContain("Shutdown failed");
		});

		it("should return error for unexpected response type", async () => {
			await client.connect("/test/socket");

			const shutdownPromise = client.shutdown();

			// Simulate unexpected response
			const dataHandler = socketListeners.data![0]!;
			const response = {
				id: "msg-0",
				type: "state",
				data: {},
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response)}\n`));

			const result = await shutdownPromise;

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Unexpected response type");
		});

		it("should return error if not connected", async () => {
			const result = await client.shutdown();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Not connected");
		});
	});

	describe("message handling", () => {
		it("should handle multiple messages in one data chunk", async () => {
			await client.connect("/test/socket");

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			// Simulate multiple messages in one data chunk
			const dataHandler = socketListeners.data![0]!;
			const response1: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } },
			};
			const response2: IPCResponse = {
				id: "msg-1",
				type: "state",
				data: { system: { mode: "persistent" } },
			};
			const data = `${IPCSerializer.serialize(response1)}\n${IPCSerializer.serialize(response2)}\n`;
			dataHandler(Buffer.from(data));

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1.isOk()).toBe(true);
			expect(result1._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
			expect(result2.isOk()).toBe(true);
			expect(result2._unsafeUnwrap()).toEqual({ system: { mode: "persistent" } });
		});

		it("should handle incomplete messages", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			// Simulate incomplete message (no newline)
			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } },
			};
			dataHandler(Buffer.from(IPCSerializer.serialize(response)));

			// Message should not be processed yet
			// Send the rest of the message with newline
			dataHandler(Buffer.from("\n"));

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should ignore malformed JSON messages", async () => {
			await client.connect("/test/socket");

			const dataHandler = socketListeners.data![0]!;

			// Should not throw
			expect(() => {
				dataHandler(Buffer.from("invalid json\n"));
			}).not.toThrow();
		});

		it("should ignore empty lines", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();

			const dataHandler = socketListeners.data![0]!;
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } },
			};
			// Send empty line then valid message
			dataHandler(Buffer.from(`\n${IPCSerializer.serialize(response)}\n`));

			const result = await queryPromise;

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual({ system: { mode: "task" } });
		});

		it("should reject pending requests when socket closes", async () => {
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
			await client.connect("/test/socket");

			const query1Promise = client.queryState();
			const query2Promise = client.queryState();

			const dataHandler = socketListeners.data![0]!;

			// Respond to first query
			const response1: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { first: true },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response1)}\n`));

			// Respond to second query
			const response2: IPCResponse = {
				id: "msg-1",
				type: "state",
				data: { second: true },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(response2)}\n`));

			const result1 = await query1Promise;
			const result2 = await query2Promise;

			expect(result1._unsafeUnwrap()).toEqual({ first: true });
			expect(result2._unsafeUnwrap()).toEqual({ second: true });
		});

		it("should handle mixed request types", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();
			const commandPromise = client.executeCommand({ type: "test.command" });

			const dataHandler = socketListeners.data![0]!;

			// Respond to query
			const queryResponse: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { mode: "task" },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(queryResponse)}\n`));

			// Respond to command
			const commandResponse: IPCResponse = {
				id: "msg-1",
				type: "result",
				data: { executed: true },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(commandResponse)}\n`));

			const queryResult = await queryPromise;
			const commandResult = await commandPromise;

			expect(queryResult._unsafeUnwrap()).toEqual({ mode: "task" });
			expect(commandResult._unsafeUnwrap()).toEqual({ executed: true });
		});
	});

	describe("event handling", () => {
		it("should emit events to registered listeners", async () => {
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:start", handler);

			// Simulate event from server
			const dataHandler = socketListeners.data![0]!;
			const event: IPCEvent = {
				type: "event",
				name: "command:start",
				data: { commandType: "test.command" },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));

			// Handler should be called with event data
			expect(handler).toHaveBeenCalledWith({ commandType: "test.command" });
		});

		it("should support multiple listeners for the same event", async () => {
			await client.connect("/test/socket");

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			client.on("command:success", handler1);
			client.on("command:success", handler2);

			const dataHandler = socketListeners.data![0]!;
			const event: IPCEvent = {
				type: "event",
				name: "command:success",
				data: { commandType: "test.command", result: { value: 42 } },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));

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
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.once("system:shutdown", handler);

			const dataHandler = socketListeners.data![0]!;
			const event: IPCEvent = {
				type: "event",
				name: "system:shutdown",
				data: { code: 0 },
			};

			// Emit event twice
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));

			// Handler should only be called once
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ code: 0 });
		});

		it("should support off() to unsubscribe from events", async () => {
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:error", handler);
			client.off("command:error", handler);

			const dataHandler = socketListeners.data![0]!;
			const event: IPCEvent = {
				type: "event",
				name: "command:error",
				data: { commandType: "test.command", error: new Error("Test error") },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));

			// Handler should not be called after unsubscribing
			expect(handler).not.toHaveBeenCalled();
		});

		it("should support onAny() for wildcard listeners", async () => {
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.onAny(handler);

			const dataHandler = socketListeners.data![0]!;

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

			dataHandler(Buffer.from(`${IPCSerializer.serialize(event1)}\n`));
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event2)}\n`));

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
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.onAny(handler);
			client.offAny(handler);

			const dataHandler = socketListeners.data![0]!;
			const event: IPCEvent = {
				type: "event",
				name: "command:start",
				data: { commandType: "test" },
			};
			dataHandler(Buffer.from(`${IPCSerializer.serialize(event)}\n`));

			// Handler should not be called after unsubscribing
			expect(handler).not.toHaveBeenCalled();
		});

		it("should handle mixed request-response and event messages", async () => {
			await client.connect("/test/socket");

			const queryPromise = client.queryState();
			const eventHandler = vi.fn();
			client.on("command:success", eventHandler);

			const dataHandler = socketListeners.data![0]!;

			// Send event and response mixed
			const event: IPCEvent = {
				type: "event",
				name: "command:success",
				data: { commandType: "test.command", result: { success: true } },
			};
			const response: IPCResponse = {
				id: "msg-0",
				type: "state",
				data: { system: { mode: "task" } },
			};

			const data = `${IPCSerializer.serialize(event)}\n${IPCSerializer.serialize(response)}\n`;
			dataHandler(Buffer.from(data));

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
			await client.connect("/test/socket");

			const handler = vi.fn();
			client.on("command:start", handler);

			const dataHandler = socketListeners.data![0]!;

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

			dataHandler(
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
});
