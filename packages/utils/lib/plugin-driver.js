import LogManager from './log-manager';

/**
 * Plugin and PluginDriver types are generic so that hook
 * signatures can be colocated with the relevant package.
 */

/**
 * @typedef PluginContext
 * @property {import('./log-manager').Logger} logger
 */

/**
 * @template {unknown[]} T
 * @typedef  {T extends [any, infer U] ? U : never} Second get the second type in a tuple
 */

/**
 * @template {unknown} [T=undefined]
 * @typedef {(ctx: PluginContext, args: T) => void | Promise<void>} Hook
 */

/**
 * @template {Record<string, Hook>} T
 * @typedef Plugin
 * @property {string} name
 * @property {Partial<T>} hooks
 */

/**
 * Manage plugins and run hooks.
 * @template {Record<string, Hook>} T
 */
export default class PluginDriver {
	/**
	 * @readonly
	 * @type {ReadonlyArray<Plugin<T>>}
	 */
	#plugins;

	/**
	 * @readonly
	 * @type {ReadonlyMap<Plugin, PluginContext>}
	 */
	#pluginContexts;

	/**
	 * @param {Plugin<T>[]} plugins
	 */
	constructor(plugins) {
		this.#plugins = plugins;

		this.#pluginContexts = new Map(
			plugins.map((plugin) => [
				plugin,
				{
					logger: LogManager.getInstance().getLogger(plugin.name)
				}
			])
		);
	}

	/**
	 * Run a hook in all plugins sequentially
	 * @template {keyof T} K
	 * @param {K} hookName
	 * @param {Second<Parameters<T[K]>>} args
	 */
	async runHookSequential(hookName, args) {
		for (const plugin of this.#plugins) {
			const hook = plugin.hooks[hookName];
			if (hook) {
				await hook(this.#pluginContexts.get(plugin), args);
			}
		}
	}
}
