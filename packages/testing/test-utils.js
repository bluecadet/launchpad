import { vi } from 'vitest';

/**
 * Creates a mock logger for testing purposes
 * @returns {import('@bluecadet/launchpad-utils').Logger}
 */
export function createMockLogger() {
	return {
		child: vi.fn(),
		once: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	};
}
