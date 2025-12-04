import net from "node:net";
import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { SubsystemContext } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { fs } from "memfs";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPCSerializer } from "../../utils/ipc-serializer.js";
import { createIPCTransport, type IPCMessage, type IPCResponse } from "../ipc-transport.js";

type Cb = (...args: any[]) => void;

// Mock net.createServer
let mockServerListeners: { [key: string]: Cb[] } = {};
let connectionCallback: Cb | null = null;
let mockServer: any;
let _mockClients: any[] = [];

type MutableContext = {
	-readonly [K in keyof SubsystemContext]: SubsystemContext[K];
};

const createMockNetServer = () => {
	mockServerListeners = {};
	_mockClients = [];

	mockServer = {
		listen: vi.fn((_socketPath: string, callback: Cb) => {
			// Call immediately (synchronously) for tests
			callback();
		}),
		close: vi.fn((callback?: Cb) => {
			if (callback) callback();
		}),
		on: vi.fn((event: string, handler: Cb) => {
			if (!mockServerListeners[event]) {
				mockServerListeners[event] = [];
			}
			mockServerListeners[event].push(handler);

			if (event === "connection") {
				connectionCallback = handler;
			}
		}),
	};

	return mockServer;
};

const createMockSocket = () => {
	const socketListeners: { [key: string]: Cb[] } = {};

	return {
		write: vi.fn((_data: string, callback?: Cb) => {
			if (callback) callback();
		}),
		end: vi.fn(),
		on: vi.fn((event: string, handler: Cb) => {
			if (!socketListeners[event]) {
				socketListeners[event] = [];
			}
			socketListeners[event].push(handler);
		}),
		listeners: socketListeners,
		emit: (event: string, ...args: any[]) => {
			if (socketListeners[event]) {
				socketListeners[event].forEach((handler) => handler(...args));
			}
		},
	};
};

function createTestIPCTransport() {
	fs.mkdirSync("/test", { recursive: true });

	const abortController = new AbortController();

	const context: MutableContext = {
		cwd: "/",
		logger: createMockLogger(),
		eventBus: createMockEventBus() as any,
		abortSignal: abortController.signal,
		dispatchCommand: vi.fn().mockReturnValue(okAsync({ result: "success" })),
		getState: vi.fn().mockReturnValue({ system: { mode: "task" } }),
		onStatePatch: vi.fn().mockReturnValue(() => {}),
	};

	const transport = createIPCTransport({ socketPath: "/test/socket" });

	return { transport, context };
}

describe("ipc-transport", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		(vi.spyOn(net, "createServer" as any) as any).mockImplementation(() => createMockNetServer());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("start", () => {
		it("should attempt to start the IPC transport", async () => {
			const { transport, context } = createTestIPCTransport();

			await transport.setup(context);

			// Transport creation may succeed or fail depending on net mocking
			// but at least it should try to create server
			expect(net.createServer).toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("should stop the IPC transport", async () => {
			const { transport, context } = createTestIPCTransport();

			const _result = await transport.setup(context);

			expect(_result.isOk()).toBe(true);

			const stopResult = await _result._unsafeUnwrap().disconnect({
				type: "manual",
			});

			expect(stopResult.isOk()).toBe(true);
			expect(mockServer.close).toHaveBeenCalled();
		});

		it("should handle already stopped transport", async () => {
			const { transport, context } = createTestIPCTransport();

			const _result = await transport.setup(context);

			expect(_result.isOk()).toBe(true);

			// First stop
			const stopResult1 = await _result._unsafeUnwrap().disconnect({
				type: "manual",
			});

			expect(stopResult1.isOk()).toBe(true);

			// Second stop (should be no-op)
			const stopResult = await _result._unsafeUnwrap().disconnect({
				type: "manual",
			});

			expect(stopResult.isOk()).toBe(true);
		});
	});

	describe("message handling", () => {
		it("should handle query-state message", async () => {
			const { transport, context } = createTestIPCTransport();

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			// Check that response was written (should be called once with string)
			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const parsed = IPCSerializer.deserialize(writtenData) as IPCResponse;
			expect(parsed.type).toBe("state");
		});

		it("should return state from stateStore for query-state", async () => {
			const { transport, context } = createTestIPCTransport();

			const testState = { system: { mode: "persistent", uptime: 1000 } };
			context.getState = vi.fn().mockReturnValue(testState);

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			// Extract the response that was written
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("state");
			expect((response as any).data).toEqual(testState);
		});

		it("should handle execute-command message", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "content.fetch" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			// Give async operation time to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(context.dispatchCommand).toHaveBeenCalledWith({
				type: "content.fetch",
			});
		});

		it("should send command result to client", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "content.fetch" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("result");
			expect((response as any).data).toEqual({ result: "success" });
		});

		it("should handle shutdown message", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			// Mock process.exit
			vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			const message: IPCMessage = {
				type: "shutdown",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			// Should send ack
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("ack");

			// Give timeout time to execute
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it("should handle malformed JSON", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from("invalid json\n"));

			// Should send error response
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("error");
			expect((response as any).error.message).toContain("Invalid JSON");
		});

		it("should ignore empty lines", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`\n${IPCSerializer.serialize(message)}\n`));

			// Should still process the valid message
			expect(mockSocket.write).toHaveBeenCalled();
		});

		it("should handle multiple messages in one chunk", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message1: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const message2: IPCMessage = {
				type: "query-state",
				id: "msg-2",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(
				Buffer.from(`${IPCSerializer.serialize(message1)}\n${IPCSerializer.serialize(message2)}\n`),
			);

			// Should send two responses
			expect(mockSocket.write).toHaveBeenCalledTimes(2);
		});

		it("should handle incomplete messages", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;

			// Send message without newline
			dataHandler(Buffer.from(JSON.stringify(message)));

			// Should not send response yet
			expect(mockSocket.write).not.toHaveBeenCalled();

			// Send the newline
			dataHandler(Buffer.from("\n"));

			// Now should send response
			expect(mockSocket.write).toHaveBeenCalled();
		});
	});

	describe("client lifecycle", () => {
		it("should track connected clients", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket1 = createMockSocket();
			const mockSocket2 = createMockSocket();

			connectionCallback?.(mockSocket1);
			connectionCallback?.(mockSocket2);

			expect(context.logger.verbose).toHaveBeenCalledWith("IPC client connected");
			expect(context.logger.verbose).toHaveBeenCalledTimes(2);
		});

		it("should handle client disconnect", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const closeHandler = mockSocket.listeners.close![0]!;
			closeHandler();

			expect(context.logger.verbose).toHaveBeenCalledWith("IPC client disconnected");
		});

		it("should handle client error", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const errorHandler = mockSocket.listeners.error![0]!;
			errorHandler(new Error("Client error"));

			expect(context.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("IPC client error"),
			);
		});
	});

	describe("error handling", () => {
		it("should handle command execution errors", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const error = new Error("Command failed");

			// Note: The transport actually uses neverthrow ResultAsync,
			// but we need to simulate the match behavior
			context.dispatchCommand = vi.fn(
				(_cmd) =>
					({
						match: (_onOk: any, onErr: any) => {
							onErr(error);
						},
					}) as any,
			);

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "test.command" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("error");
			expect((response as any).error.message).toContain("IPC command execution failed");
			expect((response as any).error.cause!.message).toContain("Command failed");
		});

		it("should handle stateStore errors", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			context.getState = vi.fn().mockImplementation(() => {
				throw new Error("State retrieval failed");
			});

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as any;

			expect(response.type).toBe("error");
			expect(response.error.message).toContain("Failed to get controller state");
		});
	});

	describe("state patch handling", () => {
		it("should subscribe to stateStore patches on start", async () => {
			const { transport, context } = createTestIPCTransport();

			let _patchHandler: ((patches: any[], version: number) => void) | undefined;
			context.onStatePatch = vi.fn((handler) => {
				_patchHandler = handler;
				return () => {};
			});

			const result = await transport.setup(context);

			// Ensure start succeeded
			expect(result.isOk()).toBe(true);
			expect(context.onStatePatch).toHaveBeenCalled();
		});

		it("should emit state-patch event when stateStore emits patches", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				// Return unsubscribe function
				return () => {};
			});

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			// Clear previous writes (from server.listen events)
			mockSocket.write.mockClear();

			// Simulate a patch from the state store
			const testPatches = [
				{ op: "replace", path: ["subsystems", "content", "phase"], value: "complete" },
			];
			patchHandler?.(testPatches, 1);

			// Should send state-patch message to client
			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = IPCSerializer.deserialize(writtenData) as IPCResponse;

			expect(response.type).toBe("state-patch");
			expect((response as any).patches).toEqual(testPatches);
			expect((response as any).version).toBe(1);
		});

		it("should broadcast state-patch to all connected clients", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				return () => {};
			});

			await transport.setup(context);

			// Connect two clients
			const mockSocket1 = createMockSocket();
			const mockSocket2 = createMockSocket();

			connectionCallback?.(mockSocket1);
			connectionCallback?.(mockSocket2);

			// Clear previous writes
			mockSocket1.write.mockClear();
			mockSocket2.write.mockClear();

			// Simulate a patch
			const testPatches = [{ op: "add", path: ["subsystems", "monitor", "apps"], value: [] }];
			patchHandler?.(testPatches, 2);

			// Both clients should receive the patch
			expect(mockSocket1.write).toHaveBeenCalledTimes(1);
			expect(mockSocket2.write).toHaveBeenCalledTimes(1);

			const response1 = IPCSerializer.deserialize(
				mockSocket1.write.mock.calls[0]![0]!,
			) as IPCResponse;
			const response2 = IPCSerializer.deserialize(
				mockSocket2.write.mock.calls[0]![0]!,
			) as IPCResponse;

			expect(response1.type).toBe("state-patch");
			expect(response2.type).toBe("state-patch");
			expect((response1 as any).version).toBe(2);
			expect((response2 as any).version).toBe(2);
		});

		it("should handle multiple patches sequentially", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				return () => {};
			});

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);
			mockSocket.write.mockClear();

			// Send multiple patches
			patchHandler?.([{ op: "replace", path: ["system", "mode"], value: "persistent" }], 1);
			patchHandler?.([{ op: "add", path: ["data", "newField"], value: "value" }], 2);

			// Should have sent two messages
			expect(mockSocket.write).toHaveBeenCalledTimes(2);

			const response1 = IPCSerializer.deserialize(
				mockSocket.write.mock.calls[0]![0]!,
			) as IPCResponse;
			const response2 = IPCSerializer.deserialize(
				mockSocket.write.mock.calls[1]![0]!,
			) as IPCResponse;

			expect((response1 as any).version).toBe(1);
			expect((response2 as any).version).toBe(2);
		});
	});
});
