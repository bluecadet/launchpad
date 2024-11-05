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

vi.mock('pm2', () => {
	return {
		default: {
			list: vi.fn().mockImplementation(cb => cb(null, [])),
			start: vi.fn().mockImplementation((options, cb) => cb(null, {})),
			stop: vi.fn().mockImplementation((name, cb) => cb(null, {})),
			connect: vi.fn().mockImplementation((force, cb) => cb(null)),
			disconnect: vi.fn().mockImplementation(() => undefined),
			delete: vi.fn().mockImplementation((name, cb) => {
				cb(null, {});
			}),
			launchBus: vi.fn().mockImplementation((cb) => cb(null, {
				on: vi.fn()
			})),
			Client: {
				// eslint-disable-next-line n/no-callback-literal
				pingDaemon: vi.fn().mockImplementation(cb => cb(false))
			}
		}
	};
});

vi.mock('cross-spawn', () => {
	return {
		spawn: vi.fn().mockReturnValue({
			stdout: {
				on: vi.fn()
			},
			stderr: {
				on: vi.fn()
			},
			on: vi.fn().mockImplementation((event, cb) => {
				if (event === 'close') {
					cb();
				}
			})
		})
	};
});

vi.mock('node-window-manager', () => ({
	windowManager: {
		requestAccessibility: vi.fn(),
		getWindows: vi.fn().mockReturnValue([])
	}
}));

vi.mock('winston-daily-rotate-file', async () => {
	const { default: winston } = await import('winston');
	const { default: Transport } = await import('winston-transport');

	class DummyTransport extends Transport {
		/**
		 * @param {import('winston').LogEntry} info
		 */
		log(info) {
			// do nothing
		}
	}

	// @ts-expect-error
	winston.transports.DailyRotateFile = DummyTransport;

	return {
		default: undefined
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
