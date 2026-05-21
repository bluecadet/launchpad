import fs from "node:fs";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPCSerializer } from "../../utils/ipc-serializer.js";
import { createMockSocket, createTestIPCTransport } from "./helpers.js";

type Cb = (...args: any[]) => void;

// Module-level server state, reset by createMockNetServer before each test.
let connectionCallback: Cb | null = null;
let mockServer: any;

const createMockNetServer = () => {
	const mockServerListeners: { [key: string]: Cb[] } = {};
	connectionCallback = null;

	const addListener = (event: string, handler: Cb) => {
		if (!mockServerListeners[event]) {
			mockServerListeners[event] = [];
		}
		mockServerListeners[event].push(handler);

		if (event === "connection") {
			connectionCallback = handler;
		}
	};

	mockServer = {
		listen: vi.fn((_socketPath: string) => {
			mockServer.emit("listening");
		}),
		close: vi.fn((callback?: Cb) => {
			if (callback) callback();
		}),
		on: vi.fn((event: string, handler: Cb) => {
			addListener(event, handler);
			return mockServer;
		}),
		once: vi.fn((event: string, handler: Cb) => {
			const wrappedHandler: Cb = (...args) => {
				mockServer.removeListener(event, wrappedHandler);
				handler(...args);
			};
			addListener(event, wrappedHandler);
			return mockServer;
		}),
		removeListener: vi.fn((event: string, handler: Cb) => {
			mockServerListeners[event] = (mockServerListeners[event] || []).filter(
				(listener) => listener !== handler,
			);
			return mockServer;
		}),
		emit: (event: string, ...args: unknown[]) => {
			for (const handler of mockServerListeners[event] || []) {
				handler(...args);
			}
		},
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
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		vi.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("start", () => {
		it("should create the IPC server on setup", async () => {
			await createStartedIPCTransport();

			expect(net.createServer).toHaveBeenCalled();
		});

		it.skipIf(process.platform === "win32")(
			"should remove a stale socket file and retry on EADDRINUSE",
			async () => {
				vi.mocked(fs.existsSync).mockReturnValue(true);

				const staleSocketProbe = {
					once: vi.fn((event: string, handler: Cb) => {
						if (event === "error") {
							handler(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }));
						}
						return staleSocketProbe;
					}),
					end: vi.fn(),
				};

				(vi.spyOn(net, "createConnection") as any).mockReturnValue(staleSocketProbe);

				const firstServer = createMockNetServer();
				firstServer.listen.mockImplementationOnce((_socketPath: string) => {
					firstServer.emit(
						"error",
						Object.assign(new Error("Address in use"), { code: "EADDRINUSE" }),
					);
				});

				const secondServer = createMockNetServer();

				(vi.spyOn(net, "createServer" as any) as any)
					.mockImplementationOnce(() => firstServer)
					.mockImplementationOnce(() => secondServer);

				const { transport, context } = createTestIPCTransport();
				const result = await transport.setup(context);

				expect(result.isOk()).toBe(true);
				expect(fs.unlinkSync).toHaveBeenCalledWith("/test/socket");
				expect(context.logger.warn).toHaveBeenCalledWith(
					'Removing stale IPC socket at "/test/socket"',
				);
				expect(net.createServer).toHaveBeenCalledTimes(2);
			},
		);

		it("should fail startup when the socket is already owned by a live server", async () => {
			const activeSocketProbe = {
				once: vi.fn((event: string, handler: Cb) => {
					if (event === "connect") {
						handler();
					}
					return activeSocketProbe;
				}),
				end: vi.fn(),
			};

			(vi.spyOn(net, "createConnection") as any).mockReturnValue(activeSocketProbe);

			const liveServer = createMockNetServer();
			liveServer.listen.mockImplementationOnce((_socketPath: string) => {
				liveServer.emit(
					"error",
					Object.assign(new Error("Address in use"), { code: "EADDRINUSE" }),
				);
			});

			(vi.spyOn(net, "createServer" as any) as any).mockImplementationOnce(() => liveServer);

			const { transport, context } = createTestIPCTransport();
			const result = await transport.setup(context);

			expect(result.isErr()).toBe(true);
			expect(fs.unlinkSync).not.toHaveBeenCalled();
			expect(net.createServer).toHaveBeenCalledTimes(1);
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

		it("should remove the socket file after closing", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);

			const { transport, context } = createTestIPCTransport();
			const result = await transport.setup(context);
			const stopResult = await result._unsafeUnwrap().disconnect({ type: "manual" });

			expect(stopResult.isOk()).toBe(true);
			if (process.platform === "win32") {
				expect(fs.unlinkSync).not.toHaveBeenCalled();
			} else {
				expect(fs.unlinkSync).toHaveBeenCalledWith("/test/socket");
			}
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
			context.getGlobalState = vi.fn().mockReturnValue(testState);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message = { jsonrpc: "2.0", id: 1, method: "queryState" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			expect(mockSocket.write).toHaveBeenCalledTimes(1);
			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.result).toEqual(testState);
		});

		it("should dispatch command and send result for execute-command message", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message = {
				jsonrpc: "2.0",
				id: 1,
				method: "executeCommand",
				params: { type: "content.fetch" },
			};
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.result).toEqual({ result: "success" });
		});

		it("should send ack and emit system:shutdown for shutdown message", async () => {
			const { context } = await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message = { jsonrpc: "2.0", id: 1, method: "shutdown" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.result).toBeNull();

			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(context.eventBus.getEventsOfType("system:shutdown")).toEqual([{ code: 0 }]);
		});

		it("should send error response for malformed JSON", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from("invalid json\n"));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.error).toBeDefined();
			expect(response.error.data.message).toContain("Invalid JSON");
		});

		it("should still process valid message when preceded by an empty line", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message = { jsonrpc: "2.0", id: 1, method: "queryState" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`\n${IPCSerializer.serialize(message)}\n`));

			expect(mockSocket.write).toHaveBeenCalled();
		});

		it("should handle multiple messages in one chunk", async () => {
			await createStartedIPCTransport();

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message1 = { jsonrpc: "2.0", id: 1, method: "queryState" };
			const message2 = { jsonrpc: "2.0", id: 2, method: "queryState" };

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

			const message = { jsonrpc: "2.0", id: 1, method: "queryState" };
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

			const message = {
				jsonrpc: "2.0",
				id: 1,
				method: "executeCommand",
				params: { type: "test.command" },
			};
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			await new Promise((resolve) => setTimeout(resolve, 10));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.error).toBeDefined();
			expect(response.error.data.message).toContain("IPC command execution failed");
			expect(response.error.data.cause!.message).toContain("Command failed");
		});

		it("should send error response when getState throws", async () => {
			const { transport, context } = createTestIPCTransport();
			await transport.setup(context);

			context.getGlobalState = vi.fn().mockImplementation(() => {
				throw new Error("State retrieval failed");
			});

			// Re-setup with updated context
			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);

			const message = { jsonrpc: "2.0", id: 1, method: "queryState" };
			const dataHandler = mockSocket.listeners.data![0]!;
			dataHandler(Buffer.from(`${IPCSerializer.serialize(message)}\n`));

			const response = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(response.error).toBeDefined();
			expect(response.error.data.message).toContain("Failed to get controller state");
		});
	});

	describe("state patch handling", () => {
		it("should subscribe to stateStore patches on start", async () => {
			const { transport, context } = createTestIPCTransport();

			context.onGlobalStatePatch = vi.fn().mockReturnValue(() => {});

			const result = await transport.setup(context);

			expect(result.isOk()).toBe(true);
			expect(context.onGlobalStatePatch).toHaveBeenCalled();
		});

		it("should send state-patch message to client when patch arrives", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onGlobalStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				return () => {};
			});

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);
			mockSocket.write.mockClear();

			const testPatches = [
				{ op: "replace", path: ["plugins", "content", "phase"], value: "complete" },
			];
			patchHandler?.(testPatches, 1);

			expect(mockSocket.write).toHaveBeenCalledTimes(2);
			const statePatchMsg = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			expect(statePatchMsg.method).toBe("statePatch");
			expect(statePatchMsg.params.patches).toEqual(testPatches);
			expect(statePatchMsg.params.version).toBe(1);

			const statusSnapshotMsg = IPCSerializer.deserialize(
				mockSocket.write.mock.calls[1]![0]!,
			) as any;
			expect(statusSnapshotMsg.method).toBe("statusSnapshot");
			expect(statusSnapshotMsg.params).toBeDefined();
		});

		it("should broadcast state-patch to all connected clients", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onGlobalStatePatch = vi.fn((handler) => {
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

			const testPatches = [{ op: "add", path: ["plugins", "monitor", "apps"], value: [] }];
			patchHandler?.(testPatches, 2);

			// Each patch event produces a statePatch + statusSnapshot per client
			expect(mockSocket1.write).toHaveBeenCalledTimes(2);
			expect(mockSocket2.write).toHaveBeenCalledTimes(2);

			const response1 = IPCSerializer.deserialize(mockSocket1.write.mock.calls[0]![0]!) as any;
			const response2 = IPCSerializer.deserialize(mockSocket2.write.mock.calls[0]![0]!) as any;

			expect(response1.method).toBe("statePatch");
			expect(response2.method).toBe("statePatch");
			expect(response1.params.version).toBe(2);
			expect(response2.params.version).toBe(2);

			const snapshot1 = IPCSerializer.deserialize(mockSocket1.write.mock.calls[1]![0]!) as any;
			const snapshot2 = IPCSerializer.deserialize(mockSocket2.write.mock.calls[1]![0]!) as any;
			expect(snapshot1.method).toBe("statusSnapshot");
			expect(snapshot2.method).toBe("statusSnapshot");
		});

		it("should handle multiple patches sequentially", async () => {
			const { transport, context } = createTestIPCTransport();
			let patchHandler: ((patches: any[], version: number) => void) | undefined;

			context.onGlobalStatePatch = vi.fn((handler) => {
				patchHandler = handler;
				return () => {};
			});

			await transport.setup(context);

			const mockSocket = createMockSocket();
			connectionCallback?.(mockSocket);
			mockSocket.write.mockClear();

			patchHandler?.([{ op: "replace", path: ["system", "mode"], value: "persistent" }], 1);
			patchHandler?.([{ op: "add", path: ["data", "newField"], value: "value" }], 2);

			// Two patch events × two messages each (statePatch + statusSnapshot) = 4 writes
			expect(mockSocket.write).toHaveBeenCalledTimes(4);

			const response1 = IPCSerializer.deserialize(mockSocket.write.mock.calls[0]![0]!) as any;
			const response2 = IPCSerializer.deserialize(mockSocket.write.mock.calls[2]![0]!) as any;

			expect(response1.params.version).toBe(1);
			expect(response2.params.version).toBe(2);
		});
	});
});
