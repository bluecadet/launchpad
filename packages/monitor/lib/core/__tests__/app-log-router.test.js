import { describe, it, expect, vi } from 'vitest';
import AppLogRouter from '../app-log-router.js';
import { LogModes } from '../../monitor-config.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

vi.mock('@bluecadet/launchpad-utils', async () => {
	return {
		LogManager: {
			getInstance: vi.fn(() => ({
				getFilePath: vi.fn((name) => `/logs/${name}.log`)
			})),
			/**
       * @param {string} name
       * @param {import('@bluecadet/launchpad-utils').Logger} parent
       * @returns {import('@bluecadet/launchpad-utils').Logger}
       */
			getLogger: (name, parent) => {
				return parent.child({ module: name });
			}
		}
	};
});

export function createMockSubEmitterSocket() {
	/** @type {Map<string, Function[]>} */
	const listeners = new Map();

	/** @type {import('axon').SubEmitterSocket} */
	const mockSubEmitterSocket = {
		// @ts-ignore
		on: vi.fn((event, listener) => {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		}),
		// @ts-ignore
		off: vi.fn((event, listener) => {
			listeners.set(event, listeners.get(event)?.filter(l => l !== listener) ?? []);
		}),
		onmessage: vi.fn(),
		bind: vi.fn(),
		connect: vi.fn(),
		close: vi.fn()
	};

	/**
	 * @param {string} event
	 * @param {*} data
	 */
	function emit(event, data) {
		listeners.get(event)?.forEach(listener => listener(data));
		listeners.get('*')?.forEach(listener => listener(event, data));
	}

	return { mockSubEmitterSocket, emit };
}

/**
 * @param {{
 *  pm2?: Partial<import('../../monitor-config.js').ResolvedAppConfig['pm2']>, 
 *  windows?: Partial<import('../../monitor-config.js').ResolvedAppConfig['windows']>, 
 *  logging?: Partial<import('../../monitor-config.js').ResolvedAppConfig['logging']>
 * }} configOverrides
 */
function buildTestAppLogRouter(configOverrides = {}) {
	const rootLogger = createMockLogger();

	/** @type {import('../../monitor-config.js').ResolvedAppConfig} */
	const mockAppConfig = {
		pm2: {
			name: 'test-app',
			script: 'test.js',
			...configOverrides.pm2
		},
		windows: {
			foreground: false,
			minimize: false,
			hide: false,
			...configOverrides.windows
		},
		logging: {
			logToLaunchpadDir: true,
			mode: LogModes.LogBusEvents,
			showStdout: true,
			showStderr: true,
			...configOverrides.logging
		}
	};

	const appLogRouter = new AppLogRouter(rootLogger);
	appLogRouter.initAppOptions(mockAppConfig);
	const appLogger = rootLogger.children.get('test-app');

	if (!appLogger) {
		throw new Error('App logger not found');
	}

	return { appLogRouter, appLogger, rootLogger, mockAppConfig };
}

describe('AppLogRouter', () => {
	describe('initAppOptions', () => {
		it('should initialize bus logging relay when mode is bus', () => {
			const { appLogRouter, mockAppConfig } = buildTestAppLogRouter();

			const logRelays = Object.getOwnPropertyDescriptor(appLogRouter, '_logRelays')?.value;
			expect(logRelays.get('test-app')).toBeDefined();
			expect(mockAppConfig.pm2.output).toBe('/dev/null');
			expect(mockAppConfig.pm2.error).toBe('/dev/null');
		});

		it('should initialize file logging relay when mode is file', () => {
			const { appLogRouter, mockAppConfig } = buildTestAppLogRouter({
				logging: {
					mode: LogModes.TailLogFile
				}
			});
			
			const logRelays = Object.getOwnPropertyDescriptor(appLogRouter, '_logRelays')?.value;
			expect(logRelays.get('test-app')).toBeDefined();
			expect(mockAppConfig.pm2.output).toBe('/logs/test-app-stdout.log');
			expect(mockAppConfig.pm2.error).toBe('/logs/test-app-stderr.log');
		});
	});

	describe('event handling', () => {
		it('should route events to correct log relay', () => {
			const { appLogRouter, appLogger } = buildTestAppLogRouter();
			const { mockSubEmitterSocket, emit } = createMockSubEmitterSocket();

			appLogRouter.connectToBus(mockSubEmitterSocket);
			expect(mockSubEmitterSocket.on).toHaveBeenCalledWith('*', expect.any(Function));

			emit('log:out', {
				process: { name: 'test-app' },
				data: 'test log message\n'
			});

			expect(appLogger.info).toHaveBeenCalledWith('test log message');

			emit('log:err', {
				process: { name: 'test-app' },
				data: 'test err message\n'
			});

			expect(appLogger.error).toHaveBeenCalledWith('test err message');
		});

		it('should handle disconnection', () => {
			const { appLogRouter } = buildTestAppLogRouter();

			const { mockSubEmitterSocket } = createMockSubEmitterSocket();

			appLogRouter.connectToBus(mockSubEmitterSocket);
			appLogRouter.disconnectFromBus(mockSubEmitterSocket);
			
			expect(mockSubEmitterSocket.off).toHaveBeenCalledWith('*');
		});
	});
});
