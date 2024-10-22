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
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void} onSetupError Called when a content source fails to setup
 * @prop {(ctx: CombinedContentHookContext) => void} onContentFetchSetup Called before any content is fetched
 * @prop {(ctx: CombinedContentHookContext) => void} onContentFetchDone Called when all content has been fetched
 * @prop {(ctx: CombinedContentHookContext, error: ContentError) => void} onContentFetchError Called when a content source fails to fetch
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks>} ContentPlugin
 */

/**
 * @extends {HookContextProvider<ContentHooks, ContentHookContext>}
 */
export class ContentPluginDriver extends HookContextProvider {
	/**
	 * @type {import('./utils/data-store.js').DataStore}
	 */
	#dataStore;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<ContentHooks>} wrappee
	 * @param {object} options
	 * @param {import('./utils/data-store.js').DataStore} options.dataStore
	 */
	constructor(wrappee, { dataStore }) {
		super(wrappee);
		this.#dataStore = dataStore;
	}

	/**
	 * @override
	 */
	_getPluginContext() {
		return {
			data: this.#dataStore
		};
	}
}
