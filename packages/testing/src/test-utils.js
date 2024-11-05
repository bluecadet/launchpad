import { vi } from 'vitest';

/**
 * @typedef MockLogger
 * @prop {Map<string, MockLogger>} children
 * @prop {(options: *) => MockLogger} child
 * @prop {Function} once
 * @prop {Function} debug
 * @prop {Function} info
 * @prop {Function} warn
 * @prop {Function} error
 * @prop {Function} close
 */

export function createMockLogger() {
	/** @type {Map<string, MockLogger>} */
	const children = new Map();
	return {
		/**
		 * @param {Parameters<MockLogger['child']>[0]} options
		 */
		child: (options) => {
			const child = createMockLogger();
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
