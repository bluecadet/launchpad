import type { SubEmitterSocket } from "axon";
import { vi } from "vitest";

export function createMockSubEmitterSocket() {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const listeners: Map<string, ((...args: any[]) => void)[]> = new Map();

	const mockSubEmitterSocket: SubEmitterSocket = {
		on: vi.fn((event, listener) => {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
			return mockSubEmitterSocket;
		}),
		off: vi.fn((event) => {
			listeners.set(event, []);
			return mockSubEmitterSocket;
		}),
		onmessage: vi.fn(),
		bind: vi.fn(),
		connect: vi.fn(),
		close: vi.fn(),
	};

	function emit(event: string, data: unknown) {
		for (const listener of listeners.get(event) ?? []) {
			listener(data);
		}
		for (const listener of listeners.get("*") ?? []) {
			listener(event, data);
		}
	}

	return { mockSubEmitterSocket, emit };
}
