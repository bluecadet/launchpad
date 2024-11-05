import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorPluginDriver } from '../monitor-plugin-driver.js';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

describe('MonitorPluginDriver', () => {
	/** @type {MonitorPluginDriver} */
	let monitorPluginDriver;
	/** @type {import('@bluecadet/launchpad-utils').Logger} */
	let mockLogger;
	/** @type {import('../monitor-plugin-driver.js').MonitorPlugin} */
	let mockPlugin;
	/** @type {import('../../launchpad-monitor.js').LaunchpadMonitor} */
	let mockMonitor;

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockPlugin = {
			name: 'test-plugin',
			hooks: {
				beforeConnect: vi.fn(),
				afterConnect: vi.fn(),
				beforeDisconnect: vi.fn(),
				afterDisconnect: vi.fn(),
				beforeAppStart: vi.fn(),
				afterAppStart: vi.fn(),
				beforeAppStop: vi.fn(),
				afterAppStop: vi.fn(),
				onAppError: vi.fn(),
				onAppLog: vi.fn(),
				onAppErrorLog: vi.fn(),
				beforeShutdown: vi.fn()
			}
		};

		mockMonitor = {
			_logger: mockLogger,
			// @ts-expect-error
			_busManager: {
				addEventHandler: vi.fn()
			}
		};

		const basePluginDriver = new PluginDriver(mockLogger, [mockPlugin]);
		monitorPluginDriver = new MonitorPluginDriver(basePluginDriver, { monitor: mockMonitor });
	});

	describe('constructor', () => {
		it('should register bus event handler', () => {
			expect(mockMonitor._busManager.addEventHandler).toHaveBeenCalledWith(
				expect.any(Function)
			);
		});
	});

	describe('_getPluginContext', () => {
		it('should return context with monitor instance', () => {
			const context = monitorPluginDriver._getPluginContext();
			expect(context).toEqual({
				monitor: mockMonitor
			});
		});
	});

	describe('_handleBusEvent', () => {
		it('should handle process error events', () => {
			monitorPluginDriver._handleBusEvent('process:event', {
				process: { name: 'test-app' },
				event: 'error',
				data: 'test error'
			});

			expect(mockPlugin.hooks.onAppError).toHaveBeenCalledWith(
				expect.any(Object),
				{
					appName: 'test-app',
					error: expect.any(Error)
				}
			);
		});

		it('should handle stdout log events', () => {
			monitorPluginDriver._handleBusEvent('log:out', {
				process: { name: 'test-app' },
				data: 'test log'
			});

			expect(mockPlugin.hooks.onAppLog).toHaveBeenCalledWith(
				expect.any(Object),
				{
					appName: 'test-app',
					data: 'test log'
				}
			);
		});

		it('should handle stderr log events', () => {
			monitorPluginDriver._handleBusEvent('log:err', {
				process: { name: 'test-app' },
				data: 'test error log'
			});

			expect(mockPlugin.hooks.onAppErrorLog).toHaveBeenCalledWith(
				expect.any(Object),
				{
					appName: 'test-app',
					data: 'test error log'
				}
			);
		});

		it('should ignore events without process name', () => {
			monitorPluginDriver._handleBusEvent('log:out', {
				data: 'test log'
			});

			expect(mockPlugin.hooks.onAppLog).not.toHaveBeenCalled();
		});
	});
});
