import { vi } from 'vitest';

/**
 * Creates a mock logger for testing purposes
 * @returns {import('@bluecadet/launchpad-utils').Logger & {children: Map<string, import('@bluecadet/launchpad-utils').Logger>}}
 */
export function createMockLogger() {
	/** @type {Map<string, import('@bluecadet/launchpad-utils').Logger>} */
	const children = new Map();
	return {
		/**
		 * @param {Parameters<import('@bluecadet/launchpad-utils').Logger['child']>[0]} options
		 */
		child: (options) => {
			const child = createMockLogger();
			// @ts-expect-error
			children.set(options.module, child);
			return child;
		},
		once: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		close: vi.fn(),
		children
	};
}
