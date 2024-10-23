import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

export class ContentError extends Error {
	/**
	 * @param {string} [message]
	 * @param {Error} [cause]
	 */
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'ContentError';
	}
}

/**
 * @typedef ContentHookContext
 * @prop {import('./utils/data-store.js').DataStore} data
 * @prop {import('./content-options.js').ResolvedContentOptions} contentOptions
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & ContentHookContext} CombinedContentHookContext
 */

/**
 * @template T
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Awaitable<T>} Awaitable
 */

/**
 * @typedef ContentHooks
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void | Promise<void>} onSetupError Called when a content source fails to setup
 * @prop {(ctx: CombinedContentHookContext) => void | Promise<void>} onContentFetchSetup Called before any content is fetched
 * @prop {(ctx: CombinedContentHookContext) => void | Promise<void>} onContentFetchDone Called when all content has been fetched
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void | Promise<void>} onContentFetchError Called when a content source fails to fetch
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks>} ContentPlugin
 */

/**
 * Utility function for defining a content plugin
 * @param {ContentPlugin} plugin 
 * @returns {ContentPlugin}
 */
export function defineContentPlugin(plugin) {
	return plugin;
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
	 * @type {import('./content-options.js').ResolvedContentOptions}
	 */
	#options;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<ContentHooks>} wrappee
	 * @param {object} options
	 * @param {import('./utils/data-store.js').DataStore} options.dataStore
	 * @param {import('./content-options.js').ResolvedContentOptions} options.options
	 */
	constructor(wrappee, { dataStore, options }) {
		super(wrappee);
		this.#dataStore = dataStore;
		this.#options = options;
	}

	/**
	 * @override
	 */
	_getPluginContext() {
		return {
			data: this.#dataStore,
			contentOptions: this.#options
		};
	}
}
