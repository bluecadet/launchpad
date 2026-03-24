import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { SubsystemContext } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { fs } from "memfs";
import { okAsync } from "neverthrow";
import { vi } from "vitest";
import { createIPCTransport } from "../ipc-transport.js";

type Cb = (...args: any[]) => void;

export type MutableContext = {
	-readonly [K in keyof SubsystemContext]: SubsystemContext[K];
};

export const createMockSocket = () => {
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

export function createTestIPCTransport() {
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
