import net from "node:net";
import { expect, vi } from "vitest";
import { IPCClient } from "../ipc-client.js";
import { IPCSerializer } from "../utils/ipc-serializer.js";

type Cb = (...args: any[]) => void;

export function createTestClient() {
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

export async function createConnectedTestClient() {
	const helpers = createTestClient();
	await helpers.client.connect("/test/socket");
	return helpers;
}
