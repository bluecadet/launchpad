import { vi } from "vitest";
import type { Logger } from "../log-manager.ts";

export function createMockLogger(): Logger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		once: vi.fn(),
		close: vi.fn(),
		child: () => createMockLogger(),
	};
}
