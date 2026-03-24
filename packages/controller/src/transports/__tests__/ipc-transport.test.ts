import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPCSerializer } from "../../utils/ipc-serializer.js";
import type { IPCMessage, IPCResponse } from "../ipc-transport.js";
import { createMockSocket, createTestIPCTransport } from "./helpers.js";

type Cb = (...args: any[]) => void;

// Module-level server state, reset by createMockNetServer before each test.
let connectionCallback: Cb | null = null;
let mockServer: any;

const createMockNetServer = () => {
	const mockServerListeners: { [key: string]: Cb[] } = {};
	connectionCallback = null;

	mockServer = {
		listen: vi.fn((_socketPath: string, callback: Cb) => {
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

async function createStartedIPCTransport() {
	const { transport, context } = createTestIPCTransport();
	await transport.setup(context);
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
		it("should create the IPC server on setup", async () => {
			await createStartedIPCTransport();

			expect(net.createServer).toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("should stop the IPC transport", async () => {
			const { transport, context } = createTestIPCTransport();

			const result = await transport.setup(context);

			expect(result.isOk()).toBe(true);

			const stopResult = await result._unsafeUnwrap().disconnect({ type: "manual" });

			expect(stopResult.isOk()).toBe(true);
			expect(mockServer.close).toHaveBeenCalled();
		});

		it("should handle already stopped transport", async () => {
			const { transport, context } = createTestIPCTransport();

			const result = await transport.setup(context);

			expect(result.isOk()).toBe(true);

			const handle = result._unsafeUnwrap();

			const stopResult1 = await handle.disconnect({ type: "manual" });
			expect(stopResult1.isOk()).toBe(true);

			const stopResult2 = await handle.disconnect({ type: "manual" });
			expect(stopResult2.isOk()).toBe(true);
		});
	});

	describe("message handling", () => {
		it("should respond with current state for query-state message", async () => {
			const { context } = await createStartedIPCTransport();

			const testState = { system: { mode: "persistent", uptime: 1000 } };
			context.getState = vi.fn().mockReturnValue(testState);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = { type: "query-state", id: "msg-1" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("state");
			expect(response.data).toEqual(testState);
		});

		it("should dispatch command and send result for execute-command message", async () => {
			await createStartedIPCTransport();

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

			const response = IPCSerializer.deserialize(
				mockSocket.write.mock.calls[0]![0]!,
			) as IPCResponse;
			expect(response.type).toBe("result");
			expect((response as any).data).toEqual({ result: "success" });
		});

		it("should send ack and exit for shutdown message", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

			const message: IPCMessage = { type: "shutdown", id: "msg-1" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("ack");

			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it("should send error response for malformed JSON", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from("invalid json\n"));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("error");
			expect(response.error.message).toContain("Invalid JSON");
		});

		it("should still process valid message when preceded by an empty line", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = { type: "query-state", id: "msg-1" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`\n${IPCSerializer.serialize(message)}\n`));

			expect(mockSocket.write).toHaveBeenCalled();
		});

		it("should handle multiple messages in one chunk", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message1: IPCMessage = { type: "query-state", id: "msg-1" };
			const message2: IPCMessage = { type: "query-state", id: "msg-2" };

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(
				Buffer.from(`${IPCSerializer.serialize(message1)}\n${IPCSerializer.serialize(message2)}\n`),
			);

			expect(mockSocket.write).toHaveBeenCalledTimes(2);
		});

		it("should handle incomplete messages split across chunks", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = { type: "query-state", id: "msg-1" };
			const dataHandler = mockSocket.listeners.data![0]!;

			dataHandler(Buffer.from(JSON.stringify(message)));
			expect(mockSocket.write).not.toHaveBeenCalled();

			dataHandler(Buffer.from("\n"));
			expect(mockSocket.write).toHaveBeenCalled();
		});
	});

	describe("client lifecycle", () => {
		it("should log and track multiple connected clients", async () => {
			const { context } = await createStartedIPCTransport();

			const mockSocket1 = createMockSocket();
			const mockSocket2 = createMockSocket();

			connectionCallback?.(mockSocket1);
			connectionCallback?.(mockSocket2);

			expect(context.logger.verbose).toHaveBeenCalledWith("IPC client connected");
			expect(context.logger.verbose).toHaveBeenCalledTimes(2);
		});

		it("should log when a client disconnects", async () => {
			const { context } = await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const closeHandler = mockSocket.listeners.close![0]!;
			closeHandler();

			expect(context.logger.verbose).toHaveBeenCalledWith("IPC client disconnected");
		});

		it("should log client errors", async () => {
			const { context } = await createStartedIPCTransport();

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
		it("should send error response when command execution fails", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			const error = new Error("Command failed");
			context.dispatchCommand = vi.fn(
				(_cmd) =>
					({
						match: (_onOk: any, onErr: any) => {
							onErr(error);
						},
					}) as any,
			);

			// Re-setup with updated context so transport picks up new dispatchCommand
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

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("error");
			expect(response.error.message).toContain("IPC command execution failed");
			expect(response.error.cause!.message).toContain("Command failed");
		});

		it("should send error response when getState throws", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			context.getState = vi.fn().mockImplementation(() => {
				throw new Error("State retrieval failed");
			});

			// Re-setup with updated context
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message: IPCMessage = { type: "query-state", id: "msg-1" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("error");
			expect(response.error.message).toContain("Failed to get controller state");
		});
	});

	describe("state patch handling", () => {
		it("should subscribe to stateStore patches on start", async () => {
			const { transport, context } = createTestIPCTransport();

			context.onStatePatch = vi.fn().mockReturnValue(() => {});

			const result = await transport.setup(context);

			expect(result.isOk()).toBe(true);
			expect(context.onStatePatch).toHaveBeenCalled();
		});

		it("should send state-patch message to client when patch arrives", async () => {
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

			const testPatches = [
				{ op: "replace", path: ["subsystems", "content", "phase"], value: "complete" },
			];
			patchHandler?.(testPatches, 1);

			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.type).toBe("state-patch");
			expect(response.patches).toEqual(testPatches);
			expect(response.version).toBe(1);
		});

		it("should broadcast state-patch to all connected clients", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				return () => {};
			});

			await transport.setup(context);

			const mockSocket1 = createMockSocket();
			const mockSocket2 = createMockSocket();

			connectionCallback?.(mockSocket1);
			connectionCallback?.(mockSocket2);

			mockSocket1.write.mockClear();
			mockSocket2.write.mockClear();

			const testPatches = [{ op: "add", path: ["subsystems", "monitor", "apps"], value: [] }];
			patchHandler?.(testPatches, 2);

			expect(mockSocket1.write).toHaveBeenCalledTimes(1);
			expect(mockSocket2.write).toHaveBeenCalledTimes(1);

			const response1 = IPCSerializer.deserialize(mockSocket1.write.mock.calls[0]![0]!) as any;
			const response2 = IPCSerializer.deserialize(mockSocket2.write.mock.calls[0]![0]!) as any;

			expect(response1.type).toBe("state-patch");
			expect(response2.type).toBe("state-patch");
			expect(response1.version).toBe(2);
			expect(response2.version).toBe(2);
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

			patchHandler?.([{ op: "replace", path: ["system", "mode"], value: "persistent" }], 1);
			patchHandler?.([{ op: "add", path: ["data", "newField"], value: "value" }], 2);

			expect(mockSocket.write).toHaveBeenCalledTimes(2);

			const response1 = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			const response2 = IPCSerializer.deserialize(mockSocket.write.mock.calls[1]![0]!) as any;

			expect(response1.version).toBe(1);
			expect(response2.version).toBe(2);
		});
	});
});
