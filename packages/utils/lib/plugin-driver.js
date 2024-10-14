import LogManager from './log-manager.js';

/**
 * Plugin and PluginDriver types are generic so that hook
 * signatures can be colocated with the relevant package.
 */

/**
 * @typedef PluginContext
 * @property {import('./log-manager.js').Logger} logger
 */

/**
 * @template {unknown[]} [T=never[]]
 * @typedef {(...args: T) => void | Promise<void>} Hook
 */

/**
 * @template {Record<string, Hook>} T
 * @typedef Plugin
 * @property {string} name
 * @property {{[K in keyof T]?: (ctx: PluginContext, ...args: Parameters<T[K]>) => void | Promise<void>}} hooks
 */

/**
 * Manage plugins and run hooks.
 * @template {Record<string, Hook>} T
 */
export default class PluginDriver {
	/**
	 * @type {Plugin<T>[]}
	 */
	#plugins = [];

	/**
	 * @readonly
	 * @type {Map<Plugin<T>, PluginContext>}
	 */
	#pluginContexts = new Map();

	/**
	 * @param {Plugin<T>[]} plugins
	 */
	constructor(plugins) {
		this.add(plugins);
	}

	/**
	 * add a plugin or array of plugins to the driver
	 * @param {Plugin<T> | Plugin<T>[]} plugins 
	 */
	add(plugins) {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];

		for (const plugin of pluginArray) {
			this.#plugins.push(plugin);
			this.#pluginContexts.set(plugin, {
				logger: LogManager.getInstance().getLogger(`plugin:${plugin.name}`)
			});
		}
	}

	/**
	 * Run a hook in all plugins sequentially, passing the same argument to each.
	 * @template {keyof T} K
	 * @param {K} hookName
	 * @param {Parameters<T[K]>} args
	 */
	async runHookSequential(hookName, ...args) {
		for (const plugin of this.#plugins) {
			const hook = plugin.hooks[hookName];
			if (hook) {
				const ctx = this.#pluginContexts.get(plugin);

				if (!ctx) {
					throw new Error(`Plugin context not found for plugin ${plugin.name}`);
				}
				
				await hook(ctx, ...args);
			}
		}
	}
}
