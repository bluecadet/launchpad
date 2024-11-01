import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

export class ContentError extends Error {
	/**
	 * @param {ConstructorParameters<typeof Error>} args
	 */
	constructor(...args) {
		super(...args);
		this.name = 'ContentError';
	}
}

/**
 * @typedef ContentHookContext
 * @prop {import('./utils/data-store.js').DataStore} data
 * @prop {import('./content-config.js').ResolvedContentConfig} contentOptions
 * @prop {object} paths
 * @prop {(source?: string) => string} paths.getDownloadPath
 * @prop {(source?: string, pluginName?: string) => string} paths.getTempPath
 * @prop {(source?: string) => string} paths.getBackupPath
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & ContentHookContext} CombinedContentHookContext
 */

/**
 * @typedef ContentHooks
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void | PromiseLike<void>} onSetupError Called when a content source fails to setup
 * @prop {(ctx: CombinedContentHookContext) => void | PromiseLike<void>} onContentFetchSetup Called before any content is fetched
 * @prop {(ctx: CombinedContentHookContext) => void | PromiseLike<void>} onContentFetchDone Called when all content has been fetched
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void | PromiseLike<void>} onContentFetchError Called when a content source fails to fetch
 */

/**
 * @template {Partial<ContentHooks>} [T=Partial<ContentHooks>]
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks, T>} ContentPlugin
 */

/**
 * Utility function for defining a content plugin
 * @template {Partial<ContentHooks>} T
 * @param {ContentPlugin<T>} plugin 
 * @returns {ContentPlugin<T>}
 */
export function defineContentPlugin(plugin) {
	return plugin;
}

/**
 * Due to a limitation of TS in jsdoc, to get the specific hook types when defining plugins,
 * we need this helper function to wrap the hooks object.
 * @template {Partial<ContentHooks>} T
 * @param {T} hooks
 * @returns {T}
 */
export function defineContentPluginHooks(hooks) {
	return hooks;
}

/**
 * @extends {HookContextProvider<ContentHooks, ContentHookContext>}
 */
export class ContentPluginDriver extends HookContextProvider {
	/**
	 * @type {import('./utils/data-store.js').DataStore}
	 */
	#dataStore;

	/**
	 * @type {import('./content-config.js').ResolvedContentConfig}
	 */
	#options;

	/**
	 * @prop {(source?: string) => string} getDownloadPath
	 * @prop {(source?: string, pluginName?: string) => string} getTempPath
	 * @prop {(source?: string) => string} getBackupPath
	 */
	#pathGetters;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<ContentHooks>} wrappee
	 * @param {object} options
	 * @param {import('./utils/data-store.js').DataStore} options.dataStore
	 * @param {import('./content-config.js').ResolvedContentConfig} options.options
	 * @param {object} options.paths
	 * @param {(source?: string) => string} options.paths.getDownloadPath
	 * @param {(source?: string, pluginName?: string) => string} options.paths.getTempPath
	 * @param {(source?: string) => string} options.paths.getBackupPath
	 */
	constructor(wrappee, { dataStore, options, paths }) {
		super(wrappee);
		this.#dataStore = dataStore;
		this.#options = options;
		this.#pathGetters = paths;
	}

	/**
	 * @param {ContentPlugin<Partial<ContentHooks>>} plugin
	 * @override
	 */
	_getPluginContext(plugin) {
		return {
			data: this.#dataStore,
			contentOptions: this.#options,
			paths: {
				getDownloadPath: this.#pathGetters.getDownloadPath,
				getBackupPath: this.#pathGetters.getBackupPath,
				// temp path is plugin-specific
				getTempPath: (/** @type {string | undefined} */ source) => this.#pathGetters.getTempPath(source, plugin.name)
			}
		};
	}
}
