import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { HostAwarePluginContext } from "@bluecadet/launchpad-utils/host-sdk";
import { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import { StatusRegistry } from "@bluecadet/launchpad-utils/status-registry";
import { fs } from "memfs";
import { okAsync } from "neverthrow";
import { vi } from "vitest";
import { createIPCTransport } from "../ipc-transport.js";

type Cb = (...args: unknown[]) => void;

export type MutableContext = {
	-readonly [K in keyof HostAwarePluginContext]: HostAwarePluginContext[K];
} & {
	eventBus: ReturnType<typeof createMockEventBus>;
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
		emit: (event: string, ...args: unknown[]) => {
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
		eventBus: createMockEventBus(),
		abortSignal: abortController.signal,
		dispatchCommand: vi.fn().mockReturnValue(okAsync({ result: "success" })),
		getGlobalState: vi.fn().mockReturnValue({ system: { mode: "task" }, plugins: {}, _version: 0 }),
		onGlobalStatePatch: vi.fn().mockReturnValue(() => {}),
		updateState: vi.fn(),
		dashboardRegistry: new DashboardRegistry(),
		statusRegistry: new StatusRegistry(),
	} satisfies MutableContext;

	const transport = createIPCTransport({ socketPath: "/test/socket" });

	return { transport, context };
}
