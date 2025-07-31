import path from "node:path";
import { fs } from "memfs";
import { err, ok, type Result } from "neverthrow";
import { expect, vi } from "vitest";
import type { LogEntry } from "winston";

vi.mock("fs", () => ({
	...fs,
	default: fs,
}));

vi.mock("fs/promises", () => ({
	...fs.promises,
	default: fs.promises,
}));

vi.mock("node:fs", () => ({
	...fs,
	default: fs,
}));

vi.mock("node:fs/promises", () => ({
	...fs.promises,
	default: fs.promises,
}));

vi.mock("ky", async (importOriginal) => {
	const ky = await importOriginal<typeof import("ky")>();
	return {
		default: ky.default.extend({
			retry: {
				limit: 0,
			},
		}),
	};
});

vi.mock("pm2", () => {
	return {
		default: {
			list: vi.fn().mockImplementation((cb) => cb(null, [])),
			start: vi.fn().mockImplementation((_options, cb) => cb(null, {})),
			stop: vi.fn().mockImplementation((_name, cb) => cb(null, {})),
			connect: vi.fn().mockImplementation((_force, cb) => cb(null)),
			disconnect: vi.fn().mockImplementation(() => undefined),
			delete: vi.fn().mockImplementation((_name, cb) => {
				cb(null, {});
			}),
			launchBus: vi.fn().mockImplementation((cb) =>
				cb(null, {
					on: vi.fn(),
				}),
			),
			Client: {
				// eslint-disable-next-line n/no-callback-literal
				pingDaemon: vi.fn().mockImplementation((cb) => cb(false)),
			},
		},
	};
});

vi.mock("cross-spawn", () => {
	return {
		spawn: vi.fn().mockReturnValue({
			stdout: {
				on: vi.fn(),
			},
			stderr: {
				on: vi.fn(),
			},
			on: vi.fn().mockImplementation((event, cb) => {
				if (event === "close") {
					cb();
				}
			}),
		}),
	};
});

vi.mock("node-window-manager", () => ({
	windowManager: {
		requestAccessibility: vi.fn(),
		getWindows: vi.fn().mockReturnValue([]),
	},
}));

vi.mock("winston-daily-rotate-file", async () => {
	const { default: winston } = await import("winston");
	const { default: Transport } = await import("winston-transport");

	class DummyTransport extends Transport {
		override log(_info: LogEntry) {
			// do nothing
		}
	}

	// @ts-expect-error
	winston.transports.DailyRotateFile = DummyTransport;

	return {
		default: undefined,
	};
});

process.chdir("/");

// neverthrow expect helpers
expect.extend({
	toBeOk: (result: Result<unknown, unknown>) => {
		if (result.isOk()) {
			return {
				pass: true,
				message: () => "Expected result to be ok",
			};
		}

		return {
			pass: false,
			message: () => "Expected result to be ok, but got error",
			expected: ok(undefined),
			actual: result.error,
		};
	},

	toBeErr: (result: Result<unknown, unknown>) => {
		if (result.isErr()) {
			return {
				pass: true,
				message: () => "Expected result to be an error",
			};
		}

		return {
			pass: false,
			message: () => "Expected result to be an error",
			expected: err(undefined),
			actual: result,
		};
	},

	toMatchPath: (received: string, expected: string) => {
		// resolve both paths to ensure they are normalized for the current platform
		const normalizedReceived = path.resolve(received);
		const normalizedExpected = path.resolve(expected);

		if (normalizedReceived === normalizedExpected) {
			return {
				pass: true,
				message: () =>
					`Expected paths not to match:\n  Received: ${normalizedReceived}\n  Expected: ${normalizedExpected}`,
			};
		}

		return {
			pass: false,
			message: () =>
				`Expected paths to match:\n  Received: ${normalizedReceived}\n  Expected: ${normalizedExpected}\n  Original received: ${received}\n  Original expected: ${expected}`,
			expected: normalizedExpected,
			actual: normalizedReceived,
		};
	},
});
