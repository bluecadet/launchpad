import { vi, expect } from 'vitest';
import { fs } from 'memfs';
import { err, ok } from 'neverthrow';

vi.mock('fs', () => ({
	...fs,
	default: fs
}));

vi.mock('fs/promises', () => ({
	...fs.promises,
	default: fs.promises
}));

vi.mock('node:fs', () => ({
	...fs,
	default: fs
}));

vi.mock('node:fs/promises', () => ({
	...fs.promises,
	default: fs.promises
}));

vi.mock('ky', async (importOriginal) => {
	/** @type {import('ky')} */
	const ky = await importOriginal();
	return {
		default: ky.default.extend({
			retry: {
				limit: 0
			}
		})
	};
});

// neverthrow expect helpers
expect.extend({
	/**
	 * @param {import('neverthrow').Result<unknown, unknown>} result
	 */
	toBeOk: (result) => {
		if (result.isOk()) {
			return {
				pass: true,
				message: () => 'Expected result to be ok'
			};
		}

		return {
			pass: false,
			message: () => 'Expected result to be ok, but got error',
			expected: ok(undefined),
			actual: result.error
		};
	},

	/**
	 * @param {import('neverthrow').Result<unknown, unknown>} result
	 */
	toBeErr: (result) => {
		if (result.isErr()) {
			return {
				pass: true,
				message: () => 'Expected result to be an error'
			};
		}

		return {
			pass: false,
			message: () => 'Expected result to be an error',
			expected: err(undefined),
			actual: result
		};
	}
});
