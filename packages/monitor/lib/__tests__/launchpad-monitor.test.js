import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LaunchpadMonitor } from '../launchpad-monitor.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { ok, okAsync } from 'neverthrow';

// Mock process.exit to prevent tests from actually exiting
// @ts-expect-error - mockImplementation returns undefined
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

function createTestMonitor(config = {
	apps: [{
		pm2: {
			name: 'test-app',
			script: 'test.js'
		}
	}]
}) {
	const rootLogger = createMockLogger();
	const monitor = new LaunchpadMonitor(config, rootLogger);
	const monitorLogger = rootLogger.children.get('monitor');

	if (!monitorLogger) {
		throw new Error('Failed to create monitor logger');
	}

	return {
		monitor,
		rootLogger,
		monitorLogger
	};
}

describe('LaunchpadMonitor', () => {
	describe('connect', () => {
		it('should connect to PM2 and bus', async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._processManager, 'connect');
			vi.spyOn(monitor._busManager, 'connect');

			const result = await monitor.connect();
      
			expect(result).toBeOk();

			expect(monitor._processManager.connect).toHaveBeenCalled();
			expect(monitor._busManager.connect).toHaveBeenCalled();
		});

		it('should handle existing daemon when deleteExistingBeforeConnect is true', async () => {
			const { monitor } = createTestMonitor();
      
			monitor._config.deleteExistingBeforeConnect = true;
			monitor._processManager.isDaemonRunning = vi.fn().mockImplementationOnce(() => okAsync(true));
			vi.spyOn(monitor._processManager, 'killPm2');
			vi.spyOn(monitor._processManager, 'deleteAllProcesses');

			const result = await monitor.connect();
      
			expect(result).toBeOk();
			expect(monitor._processManager.deleteAllProcesses).toHaveBeenCalled();
			expect(monitor._processManager.killPm2).toHaveBeenCalled();
		});
	});

	describe('disconnect', () => {
		it('should disconnect from PM2 and bus', async () => {
			const { monitor } = createTestMonitor();
      
			monitor._processManager.isDaemonRunning = vi.fn().mockImplementationOnce(() => okAsync(true));
			vi.spyOn(monitor._processManager, 'disconnect');
			vi.spyOn(monitor._busManager, 'disconnect');

			const result = await monitor.disconnect();
      
			expect(result).toBeOk();
			expect(monitor._busManager.disconnect).toHaveBeenCalled();
			expect(monitor._processManager.disconnect).toHaveBeenCalled();
		});
	});

	describe('start', () => {
		it('should connect if not already connected', async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._processManager, 'connect');
			vi.spyOn(monitor._appManager, 'startApp').mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start();
      
			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith('test-app');
			expect(monitor._processManager.connect).toHaveBeenCalled();
		});

		it('should handle null app names', async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._appManager, 'startApp').mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start(null);

			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith('test-app');
		});

		it('should handle single app name', async () => {
			const { monitor } = createTestMonitor();
      
			vi.spyOn(monitor._appManager, 'startApp').mockImplementationOnce(() => okAsync({}));

			const result = await monitor.start('test-app');
      
			expect(result).toBeOk();
			expect(monitor._appManager.startApp).toHaveBeenCalledWith('test-app');
		});
	});

	describe('stop', () => {
		it('should stop specified apps', async () => {
			const { monitor } = createTestMonitor();

			vi.spyOn(monitor._appManager, 'stopApp').mockImplementationOnce(() => okAsync({}));
      
			const result = await monitor.stop('test-app');
      
			expect(result).toBeOk();
			expect(monitor._appManager.stopApp).toHaveBeenCalledWith('test-app');
		});
	});

	describe('shutdown', () => {
		it('should stop apps and disconnect', async () => {
			const { monitor, monitorLogger } = createTestMonitor();

			vi.spyOn(monitor._appManager, 'stopApp').mockImplementationOnce(() => okAsync({}));

			const result = await monitor.shutdown();
      
			expect(result).toBeOk();
			expect(monitorLogger.info).toHaveBeenCalledWith(expect.stringContaining('Monitor exiting'));
			expect(mockExit).toHaveBeenCalled();
		});

		it('should prevent multiple shutdowns', async () => {
			const { monitor, monitorLogger } = createTestMonitor();

			monitor._isShuttingDown = true;
      
			const result = await monitor.shutdown();
      
			expect(result).toBeOk();
			expect(monitorLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Aborting exit'));
		});

		it('should handle custom exit codes', async () => {
			const { monitor } = createTestMonitor();

			await monitor.shutdown(123);
			expect(mockExit).toHaveBeenCalledWith(123);
		});
	});
});
