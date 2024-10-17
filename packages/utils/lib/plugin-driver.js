import LogManager from './log-manager.js';

/**
 * Plugin and PluginDriver types are generic so that hook
 * signatures can be colocated with the relevant package.
 */

/**
 * @typedef BaseHookContext
 * @property {import('./log-manager.js').Logger} logger
 */

/**
 * @typedef {Record<string, (ctx: any, ...args: never[]) => void | Promise<void>>} HookSet
 */

/**
 * @template {HookSet} T
 * @typedef Plugin
 * @property {string} name
 * @property {Partial<T>} hooks
 */

/**
 * @template {unknown[]} T
 * @typedef {T extends [unknown, ...infer R] ? R : []} Tail Omit the first element of a tuple
 */

/**
 * @template {HookSet} T
 * @template C
 * @typedef {{ [K in keyof T]: C extends Parameters<T[K]>[0] ? K : never }[keyof T]} KeysWithFullContext
 */

/**
 * @template T
 * @typedef {Promise<void> | void} Awaitable<T>
 */

/**
 * Manage plugins and run hooks.
 * @template {HookSet} T
 */
export default class PluginDriver {
	/**
	 * @type {Plugin<T>[]}
	 */
	#plugins = [];

	/**
	 * @returns {ReadonlyArray<Plugin<T>>}
	 */
	get plugins() {
		return this.#plugins;
	}

	/**
	 * @readonly
	 * @type {Map<Plugin<T>, BaseHookContext>}
	 */
	#baseHookContexts = new Map();

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
			this.#baseHookContexts.set(plugin, {
				logger: LogManager.getInstance().getLogger(`plugin:${plugin.name}`)
			});
		}
	}

	/**
	 * @param {Plugin<T>} plugin
	 */
	#getBaseContext(plugin) {
		const ctx = this.#baseHookContexts.get(plugin);

		if (!ctx) {
			throw new Error(`Plugin not found: ${plugin.name}`);
		}

		return ctx;
	}

	/**
	 * @template {keyof T} K
	 * @param {K} hookName
	 * @param {(plugin: Plugin<T>) => Omit<Parameters<T[K]>[0], keyof BaseHookContext>} contextGetter
	 * @param {Tail<Parameters<T[K]>>} additionalArgs
	 * @returns {Promise<void>}
	 */
	async _runHookSequentialWithCtx(hookName, contextGetter, additionalArgs) {
		for (const plugin of this.#plugins) {
			const hook = plugin.hooks[hookName];
			if (hook) {
				const context = {
					...this.#getBaseContext(plugin),
					...contextGetter(plugin)
				};
				await hook(context, ...additionalArgs);
			}
		}
	}

	/**
	 * @template {KeysWithFullContext<T, BaseHookContext>} K
	 * @param {K} hookName
	 * @param {Tail<Parameters<T[K]>>} additionalArgs
	 */
	async runHookSequential(hookName, ...additionalArgs) {
		for (const plugin of this.#plugins) {
			const hook = plugin.hooks[hookName];
			if (hook) {
				await hook(this.#getBaseContext(plugin), ...additionalArgs);
			}
		}
	}
}

/**
 * Base class for injecting additional context when running hooks.
 * @template {HookSet} T Hooks
 * @template C Context
 */
export class HookContextProvider {
	/**
	 * @type {PluginDriver<T>}
	 */
	#innerDriver;

	/**
	 * @param {PluginDriver<T>} innerDriver
	 */
	constructor(innerDriver) {
		this._initialize(innerDriver.plugins);
		this.#innerDriver = innerDriver;
	}

	get plugins() {
		return this.#innerDriver.plugins;
	}

	/**
	 * @param {ReadonlyArray<Plugin<T>>} plugins
	 * @protected
	 */
	_initialize(plugins) {
		// implement in subclass
	}

	/**
	 * @param {Plugin<T>} plugin
	 * @returns {C}
	 * @protected
	 */
	_getPluginContext(plugin) {
		throw new Error('_getPluginContext Not implemented');
	}

	/**
	 * add a plugin or array of plugins to the driver
	 * @param {Plugin<T> | Plugin<T>[]} plugins 
	 */
	add(plugins) {
		const pluginArray = Array.isArray(plugins) ? plugins : [plugins];
		this._initialize(pluginArray);
		this.#innerDriver.add(plugins);
	}

	/**
	 * @template {KeysWithFullContext<T, C & BaseHookContext>} K
	 * @param {K} hookName 
	 * @param  {Tail<Parameters<T[K]>>} additionalArgs 
	 * @returns 
	 */
	async runHookSequential(hookName, ...additionalArgs) {
		return this.#innerDriver._runHookSequentialWithCtx(
			hookName,
			this._getPluginContext,
			additionalArgs
		);
	}
}
