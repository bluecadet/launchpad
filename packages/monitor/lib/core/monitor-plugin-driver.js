import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

/**
 * @typedef MonitorHookContext
 * // TODO
 * @property {any} foo
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & MonitorHookContext} CombinedMonitorHookContext
 */

/**
 * @typedef MonitorHooks
 * // TODO
 * @property {(ctx: CombinedMonitorHookContext) => Promise<void> | void} tempMonitorHook
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<MonitorHooks>} MonitorPlugin
 */

/**
 * @extends {HookContextProvider<MonitorHooks, MonitorHookContext>}
 */
export class MonitorPluginDriver extends HookContextProvider {
	/**
	 * @override
	 */
	_getPluginContext() {
		return {
			foo: 'lorem'
		};
	}
}
