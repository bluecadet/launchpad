import { describe, it, expect, vi, beforeEach } from 'vitest';
import PluginDriver, { HookContextProvider } from '../plugin-driver.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

/** @typedef {import('../plugin-driver.js').HookSet} HookSet */

describe('PluginDriver', () => {
	describe('basic functionality', () => {
		it('should initialize with plugins', () => {
			const plugin = {
				name: 'test-plugin',
				hooks: {
					testHook: vi.fn()
				}
			};

			const mockLogger = createMockLogger();
			const driver = new PluginDriver(mockLogger, [plugin]);
			expect(driver.plugins).toContain(plugin);
		});

		it('should add plugins after initialization', () => {
			const mockLogger = createMockLogger();
			const driver = new PluginDriver(mockLogger);
			const plugin = {
				name: 'test-plugin',
				hooks: {
					testHook: vi.fn()
				}
			};

			driver.add(plugin);
			expect(driver.plugins).toContain(plugin);
		});
	});

	describe('hook execution', () => {
		it('should run hooks sequentially', async () => {
			/** @type {number[]} */
			const order = [];
			const plugin1 = {
				name: 'plugin1',
				hooks: {
					testHook: async () => {
						await new Promise(resolve => setTimeout(resolve, 10));
						order.push(1);
					}
				}
			};
			const plugin2 = {
				name: 'plugin2',
				hooks: {
					testHook: () => {
						order.push(2);
					}
				}
			};

			const mockLogger = createMockLogger();

			/** @type {PluginDriver<HookSet>} */
			const driver = new PluginDriver(mockLogger, [plugin1, plugin2]);
			await driver.runHookSequential('testHook');

			expect(order).toEqual([1, 2]);
		});

		it('should provide base context to hooks', async () => {
			/** @type {import('../plugin-driver.js').Plugin<HookSet>} */
			const plugin = {
				name: 'test-plugin',
				hooks: {
					testHook: (context) => {
						expect(context.logger).toBeDefined();
						expect(context.abortSignal).toBeDefined();
					}
				}
			};
      
			const mockLogger = createMockLogger();

			const driver = new PluginDriver(mockLogger, [plugin]);
			await driver.runHookSequential('testHook');
		});

		it('should handle hook errors', async () => {
			const plugin = {
				name: 'test-plugin',
				hooks: {
					testHook: () => {
						throw new Error('Test error');
					}
				}
			};

			const mockLogger = createMockLogger();

			const driver = new PluginDriver(mockLogger, [plugin]);
			const result = await driver._runHookSequentialWithCtx('testHook', () => ({}), []);
			
			expect(result.isErr()).toBe(true);
		});
	});
});

describe('HookContextProvider', () => {
	it('should provide additional context to hooks', async () => {
		/** @extends {HookContextProvider<HookSet, { testValue: string }>} */
		class TestContextProvider extends HookContextProvider {
			_getPluginContext() {
				return { testValue: 'test' };
			}
		}

		/** @type {import('../plugin-driver.js').Plugin<HookSet>} */
		const plugin = {
			name: 'test-plugin',
			hooks: {
				testHook: (context) => {
					expect(context.testValue).toBe('test');
				}
			}
		};

		const mockLogger = createMockLogger();

		const baseDriver = new PluginDriver(mockLogger, [plugin]);
		const provider = new TestContextProvider(baseDriver);
		
		const result = await provider.runHookSequential('testHook');
		expect(result.isOk()).toBe(true);
	});
});
