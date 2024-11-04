import { describe, it, expect, vi } from 'vitest';
import { AppManager } from '../app-manager.js';
import { ProcessManager } from '../process-manager.js';
import { BusManager } from '../bus-manager.js';
import { ok, okAsync } from 'neverthrow';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

function setupTestAppManager() {
	const mockLogger = createMockLogger();
	const processManager = new ProcessManager(mockLogger);
	const busManager = new BusManager(mockLogger);

	// Setup process manager spies
	vi.spyOn(processManager, 'startProcess').mockImplementation(() => okAsync({}));
	vi.spyOn(processManager, 'stopProcess').mockImplementation(() => okAsync({}));
	vi.spyOn(processManager, 'getProcess').mockImplementation(() => okAsync({
		pm2_env: { status: 'online' },
		pid: 123
	}));
	vi.spyOn(processManager, 'connect');
	vi.spyOn(processManager, 'disconnect');
	vi.spyOn(processManager, 'killPm2');
	vi.spyOn(processManager, 'isDaemonRunning');
	vi.spyOn(processManager, 'getProcesses');
	vi.spyOn(processManager, 'deleteProcess');
	vi.spyOn(processManager, 'deleteAllProcesses');

	// Setup bus manager spies
	vi.spyOn(busManager, 'connect').mockImplementation(() => okAsync(undefined));
	vi.spyOn(busManager, 'disconnect').mockImplementation(() => ok(undefined));
	vi.spyOn(busManager, 'initAppLogging');
	vi.spyOn(busManager, 'addEventHandler');
	vi.spyOn(busManager, 'removeEventHandler');

	/** @type {import('../../monitor-config.js').ResolvedMonitorConfig} */
	const mockConfig = {
		apps: [
			{
				pm2: {
					name: 'test-app',
					script: 'test.js'
				},
				windows: {
					foreground: false,
					minimize: false,
					hide: false
				},
				logging: {
					logToLaunchpadDir: true,
					mode: 'bus',
					showStdout: true,
					showStderr: true
				}
			}
		],
		windowsApi: {
			debounceDelay: 3000,
			nodeVersion: '>=17.4.0'
		},
		deleteExistingBeforeConnect: false,
		plugins: [],
		shutdownOnExit: true
	};

	const appManager = new AppManager(
		mockLogger,
		processManager,
		busManager,
		mockConfig
	);

	return {
		appManager,
		mockLogger,
		processManager,
		busManager,
		mockConfig
	};
}

describe('AppManager', () => {
	describe('startApp', () => {
		it('should start an app successfully', async () => {
			const { appManager, processManager, mockLogger } = setupTestAppManager();
			
			const result = await appManager.startApp('test-app');
			
			expect(processManager.startProcess).toHaveBeenCalledTimes(1);
			expect(processManager.getProcess).toHaveBeenCalledWith('test-app');
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Starting app'));
			expect(result._unsafeUnwrap()).toEqual({
				pm2_env: { status: 'online' },
				pid: 123
			});
		});

		it('should handle non-existent app names', async () => {
			const { appManager } = setupTestAppManager();

			const result = await appManager.startApp('non-existent-app');

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("No app found with the name 'non-existent-app'");
		});
	});

	describe('stopApp', () => {
		it('should stop an app successfully', async () => {
			const { appManager, processManager, mockLogger } = setupTestAppManager();
			
			await appManager.stopApp('test-app');
			
			expect(processManager.stopProcess).toHaveBeenCalledWith('test-app');
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Stopping app'));
		});
	});

	describe('isAppRunning', () => {
		it('should check if app is running', async () => {
			const { appManager, processManager } = setupTestAppManager();
			
			const result = await appManager.isAppRunning('test-app');
			
			expect(processManager.getProcess).toHaveBeenCalledWith('test-app', true);
			expect(result._unsafeUnwrap()).toBe(true);
		});
	});

	describe('validateAppNames', () => {
		it('should return all app names when input is null', () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames(null)._unsafeUnwrap();
			expect(result).toEqual(['test-app']);
		});

		it('should handle single app name', () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames('test-app')._unsafeUnwrap();
			expect(result).toEqual(['test-app']);
		});

		it('should handle array of app names', () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames(['test-app'])._unsafeUnwrap();
			expect(result).toEqual(['test-app']);
		});

		it('should throw on invalid input', async () => {
			const { appManager } = setupTestAppManager();
			// @ts-expect-error Testing invalid input
			const result = await appManager.validateAppNames(123);
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain('appNames must be null, undefined, a string or an iterable array/set of strings');
		});
	});

	describe('getAppOptions', () => {
		it('should return app options for valid app name', async () => {
			const { appManager, mockConfig } = setupTestAppManager();
			const result = await appManager.getAppOptions('test-app');
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(mockConfig.apps[0]);
		});

		it('should throw for invalid app name', async () => {
			const { appManager } = setupTestAppManager();
			const result = await appManager.getAppOptions('invalid-app');
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("No app found with the name 'invalid-app'");
		});
	});
});
