import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorPluginDriver } from '../monitor-plugin-driver.js';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

describe('MonitorPluginDriver', () => {
	/** @type {MonitorPluginDriver} */
	let monitorPluginDriver;
	/** @type {import('@bluecadet/launchpad-utils').Logger} */
	let mockLogger;
	/** @type {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<import('../monitor-plugin-driver.js').MonitorHooks>[]} */
	let mockPlugins;

	beforeEach(() => {
		mockLogger = createMockLogger();

		mockPlugins = [
			{
				name: 'test-plugin',
				hooks: {
					tempMonitorHook: vi.fn()
				}
			}
		];

		const basePluginDriver = new PluginDriver(mockLogger, mockPlugins);
		monitorPluginDriver = new MonitorPluginDriver(basePluginDriver);
	});

	describe('_getPluginContext', () => {
		it('should return the expected plugin context', () => {
			const context = monitorPluginDriver._getPluginContext();
			expect(context).toEqual({
				foo: 'lorem'
			});
		});
	});

	describe('plugin hooks', () => {
		it('should call plugin hooks with correct context', async () => {
			const plugin = mockPlugins[0];
			await monitorPluginDriver.runHookSequential('tempMonitorHook');
			
			expect(plugin.hooks.tempMonitorHook).toHaveBeenCalledWith(
				expect.objectContaining({
					foo: 'lorem'
				})
			);
		});
	});
});
