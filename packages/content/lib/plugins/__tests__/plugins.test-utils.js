import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { DataStore } from '../../utils/data-store.js';
import { vi } from 'vitest';
import { resolveContentConfig } from '../../content-config.js';

/**
 * Creates a test context with a DataStore and logger
 * @param {Object} [options]
 * @param {string[]} [options.namespaces] - Namespaces to create in the DataStore
 * @param {import('@bluecadet/launchpad-utils').Logger} [options.logger] - Logger to use
 * @param {import('../../content-config.js').ContentConfig} [options.baseOptions] - Content options to use
 * @returns {import('../../content-plugin-driver.js').CombinedContentHookContext}
*/
export function createTestPluginContext({ namespaces = ['test'], baseOptions = {}, logger = createMockLogger() } = {}) {
	const data = new DataStore();
	namespaces.forEach(namespace => data.createNamespace(namespace));
 
	return {
		data,
		logger,
		abortSignal: new AbortController().signal,
		paths: {
			getDownloadPath: vi.fn().mockReturnValue('/download'),
			getTempPath: vi.fn().mockReturnValue('/temp'),
			getBackupPath: vi.fn().mockReturnValue('/backup')
		},
		contentOptions: resolveContentConfig(baseOptions)
	};
}
