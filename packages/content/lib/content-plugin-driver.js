import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

/**
 * @typedef ContentHookContext
 * @prop {import('./utils/data-store.js').default} data
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & ContentHookContext} CombinedContentHookContext
 */

/**
 * @typedef ContentHooks
 * @prop {(ctx: CombinedContentHookContext, ) => void} onContentFetchSetup Called before any content is fetched
 * @prop {(ctx: CombinedContentHookContext, ) => void} onContentFetchData Called to initialize all content fetches
 * @prop {(ctx: CombinedContentHookContext, ) => void} onContentFetchDataDone Called when all content has been fetched
 * @prop {(ctx: CombinedContentHookContext, ) => void} onContentFetchError Called when a content source fails to fetch
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks>} ContentPlugin
 */

/**
 * @extends {HookContextProvider<ContentHooks, ContentHookContext>}
 */
export class ContentPluginDriver extends HookContextProvider {
	/**
	 * @type {import('./utils/data-store.js').default}
	 */
	#dataStore;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<ContentHooks>} wrappee
	 * @param {object} options
	 * @param {import('./utils/data-store.js').default} options.dataStore
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
