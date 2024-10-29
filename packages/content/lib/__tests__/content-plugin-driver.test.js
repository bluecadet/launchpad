import { describe, it, expect, vi } from 'vitest';
import { ContentPluginDriver, ContentError, defineContentPlugin, defineContentPluginHooks } from '../content-plugin-driver.js';
import { DataStore } from '../utils/data-store.js';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { resolveContentOptions } from '../content-options.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

describe('ContentPluginDriver', () => {
	const createMockContext = () => {
		const dataStore = new DataStore();
		const options = resolveContentOptions({
			downloadPath: '/downloads/',
			tempPath: '/temp/',
			backupPath: '/backups/'
		});

		const paths = {
			/** @param {string | undefined} source */
			getDownloadPath: (source) => source ? `/downloads/${source}` : '/downloads',
			/**
			 * @param {string | undefined} source
			 * @param {string | undefined} plugin
			 */
			getTempPath: (source, plugin) => source ? `/temp/${plugin}/${source}` : `/temp/${plugin}`,
			/** @param {string | undefined} source */
			getBackupPath: (source) => source ? `/backups/${source}` : '/backups'
		};

		return { dataStore, options, paths };
	};

	describe('plugin context', () => {
		it('should provide correct context to plugins', async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver(baseLogger);
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths
			});

			const plugin = defineContentPlugin({
				name: 'test-plugin',
				hooks: defineContentPluginHooks({
					onContentFetchDone(ctx) {
						expect(ctx.data).toBe(dataStore);
						expect(ctx.contentOptions).toBe(options);
						expect(ctx.paths.getDownloadPath).toBe(paths.getDownloadPath);
						expect(ctx.paths.getBackupPath).toBe(paths.getBackupPath);
						// Test plugin-specific temp path
						expect(ctx.paths.getTempPath('source')).toBe('/temp/test-plugin/source');
					}
				})
			});

			contentDriver.add(plugin);
			await contentDriver.runHookSequential('onContentFetchDone');
		});

		it('should handle plugin-specific temp paths correctly', async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver(baseLogger);
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths
			});

			const plugin1 = defineContentPlugin({
				name: 'plugin1',
				hooks: defineContentPluginHooks({
					onContentFetchDone(ctx) {
						expect(ctx.paths.getTempPath('source')).toBe('/temp/plugin1/source');
					}
				})
			});

			const plugin2 = defineContentPlugin({
				name: 'plugin2',
				hooks: defineContentPluginHooks({
					onContentFetchDone(ctx) {
						expect(ctx.paths.getTempPath('source')).toBe('/temp/plugin2/source');
					}
				})
			});

			contentDriver.add(plugin1);
			contentDriver.add(plugin2);
			await contentDriver.runHookSequential('onContentFetchDone');
		});
	});

	describe('error handling', () => {
		it('should handle setup errors with ContentError', async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver(baseLogger);
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths
			});

			const onSetupError = vi.fn();
			const error = new Error('Setup failed');

			const plugin = defineContentPlugin({
				name: 'error-plugin',
				hooks: defineContentPluginHooks({
					onSetupError
				})
			});

			contentDriver.add(plugin);
			await contentDriver.runHookSequential('onSetupError', new ContentError('Plugin setup failed', error));

			expect(onSetupError).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({
					name: 'ContentError',
					message: 'Plugin setup failed',
					cause: error
				})
			);
		});

		it('should handle fetch errors with ContentError', async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver(baseLogger);
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths
			});

			const onContentFetchError = vi.fn();
			const error = new Error('Fetch failed');

			const plugin = defineContentPlugin({
				name: 'error-plugin',
				hooks: defineContentPluginHooks({
					onContentFetchError
				})
			});

			contentDriver.add(plugin);
			await contentDriver.runHookSequential('onContentFetchError', new ContentError('Content fetch failed', error));

			expect(onContentFetchError).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({
					name: 'ContentError',
					message: 'Content fetch failed',
					cause: error
				})
			);
		});
	});

	describe('plugin lifecycle', () => {
		it('should call hooks in correct order', async () => {
			const { dataStore, options, paths } = createMockContext();
			const baseLogger = createMockLogger();
			const driver = new PluginDriver(baseLogger);
			const contentDriver = new ContentPluginDriver(driver, {
				dataStore,
				options,
				paths
			});

			/** @type {string[]} */
			const order = [];
			const plugin = defineContentPlugin({
				name: 'lifecycle-plugin',
				hooks: defineContentPluginHooks({
					onContentFetchSetup() {
						order.push('setup');
					},
					onContentFetchDone() {
						order.push('done');
					}
				})
			});

			contentDriver.add(plugin);
			await contentDriver.runHookSequential('onContentFetchSetup');
			await contentDriver.runHookSequential('onContentFetchDone');

			expect(order).toEqual(['setup', 'done']);
		});
	});
});
