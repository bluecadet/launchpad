import { vi } from "vitest";
import type { Logger } from "../logger.ts";

export function createMockLogger(): Logger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		child: () => createMockLogger(),
	};
}
