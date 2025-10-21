import net from "node:net";
import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { fs } from "memfs";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport, TransportContext } from "../../core/transport.js";
import { createIPCTransport, type IPCMessage, type IPCResponse } from "../ipc-transport.js";

type Cb = (...args: any[]) => void;

// Mock net.createServer
let mockServerListeners: { [key: string]: Cb[] } = {};
let mockServer: any;
let _mockClients: any[] = [];
let mockServerCallback: ((socket: any) => void) | null = null;

const createMockNetServer = () => {
	mockServerListeners = {};
	_mockClients = [];

	mockServer = {
		listen: vi.fn((_socketPath: string, callback: Cb) => {
			// Call immediately (synchronously) for tests
			callback();
		}),
		close: vi.fn((callback: Cb) => {
			callback();
		}),
		on: vi.fn((event: string, handler: Cb) => {
			if (!mockServerListeners[event]) {
				mockServerListeners[event] = [];
			}
			mockServerListeners[event].push(handler);
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

describe("ipc-transport", () => {
	const socketPath = "/test/socket";
	let transport: Transport;
	let context: TransportContext;
	let abortController: AbortController;

	beforeEach(() => {
		vi.clearAllMocks();
		mockServerCallback = null;

		(vi.spyOn(net, "createServer" as any) as any).mockImplementation(
			(callback: ((socket: any) => void) | undefined) => {
				mockServerCallback = (callback ?? null) as ((socket: any) => void) | null;
				return createMockNetServer();
			},
		);

		// Setup memfs
		fs.mkdirSync("/test", { recursive: true });

		abortController = new AbortController();
		context = {
			logger: createMockLogger(),
			abortSignal: abortController.signal,
			eventBus: createMockEventBus() as any,
			commandDispatcher: {
				dispatch: vi.fn().mockReturnValue(okAsync({ result: "success" })),
			} as any,
			stateStore: {
				getState: vi.fn().mockReturnValue({ system: { mode: "task" } }),
			} as any,
		};

		transport = createIPCTransport({ socketPath });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("start", () => {
		it("should attempt to start the IPC transport", async () => {
			const _result = await transport.start(context);

			// Transport creation may succeed or fail depending on net mocking
			// but at least it should try to create server
			expect(net.createServer).toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("should stop the IPC transport", async () => {
			await transport.start(context);

			const stopResult = await transport.stop(context);

			expect(stopResult.isOk()).toBe(true);
		});

		it("should handle already stopped transport", async () => {
			const stopResult = await transport.stop(context);

			expect(stopResult.isOk()).toBe(true);
		});
	});

	describe("message handling", () => {
		it("should handle query-state message", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			// Check that response was written (should be called once with string)
			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			expect(writtenData).toContain('"type":"state"');
		});

		it("should return state from stateStore for query-state", async () => {
			const testState = { system: { mode: "persistent", uptime: 1000 } };
			context.stateStore.getState = vi.fn().mockReturnValue(testState);

			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			// Extract the response that was written
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("state");
			expect((response as any).data).toEqual(testState);
		});

		it("should handle execute-command message", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "content.fetch" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			// Give async operation time to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(context.commandDispatcher.dispatch).toHaveBeenCalledWith({
				type: "content.fetch",
			});
		});

		it("should send command result to client", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "content.fetch" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("result");
			expect((response as any).data).toEqual({ result: "success" });
		});

		it("should handle shutdown message", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			// Mock process.exit
			vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			const message: IPCMessage = {
				type: "shutdown",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			// Should send ack
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("ack");

			// Give timeout time to execute
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it("should handle malformed JSON", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from("invalid json\n"));

			// Should send error response
			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("error");
			expect((response as any).message).toContain("Invalid JSON");
		});

		it("should ignore empty lines", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`\n${JSON.stringify(message)}\n`));

			// Should still process the valid message
			expect(mockSocket.write).toHaveBeenCalled();
		});

		it("should handle multiple messages in one chunk", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message1: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const message2: IPCMessage = {
				type: "query-state",
				id: "msg-2",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message1)}\n${JSON.stringify(message2)}\n`));

			// Should send two responses
			expect(mockSocket.write).toHaveBeenCalledTimes(2);
		});

		it("should handle incomplete messages", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

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
			await transport.start(context);

			const mockSocket1 = createMockSocket();
			const mockSocket2 = createMockSocket();

			mockServerCallback?.(mockSocket1);
			mockServerCallback?.(mockSocket2);

			expect(context.logger.debug).toHaveBeenCalledWith("IPC client connected");
			expect(context.logger.debug).toHaveBeenCalledTimes(2);
		});

		it("should handle client disconnect", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const closeHandler = mockSocket.listeners.close![0]!;
			closeHandler();

			expect(context.logger.debug).toHaveBeenCalledWith("IPC client disconnected");
		});

		it("should handle client error", async () => {
			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const errorHandler = mockSocket.listeners.error![0]!;
			errorHandler(new Error("Client error"));

			expect(context.logger.error).toHaveBeenCalledWith(
				expect.stringContaining("IPC client error"),
			);
		});
	});

	describe("error handling", () => {
		it("should handle command execution errors", async () => {
			const error = new Error("Command failed");

			// Note: The transport actually uses neverthrow ResultAsync,
			// but we need to simulate the match behavior
			context.commandDispatcher.dispatch = vi.fn(
				(_cmd) =>
					({
						match: (_onOk: any, onErr: any) => {
							onErr(error);
						},
					}) as any,
			);

			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "execute-command",
				id: "msg-1",
				data: { type: "test.command" },
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("error");
			expect((response as any).message).toContain("Command failed");
		});

		it("should handle stateStore errors", async () => {
			context.stateStore.getState = vi.fn().mockImplementation(() => {
				throw new Error("State retrieval failed");
			});

			await transport.start(context);

			const mockSocket = createMockSocket();
			mockServerCallback?.(mockSocket);

			const message: IPCMessage = {
				type: "query-state",
				id: "msg-1",
			};

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${JSON.stringify(message)}\n`));

			const writtenData = mockSocket.write.mock.calls[0]![0]!;
			const response = JSON.parse(writtenData) as IPCResponse;

			expect(response.type).toBe("error");
			expect((response as any).message).toContain("Failed to get state");
		});
	});

	describe("id property", () => {
		it("should have id property set to 'ipc'", () => {
			expect(transport.id).toBe("ipc");
		});
	});
});
