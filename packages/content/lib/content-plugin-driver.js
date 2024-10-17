import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { DataFile } from './content-sources/content-result.js';
import mdToHtml from './plugins/transforms/md-to-html.js';
import sanityToHtml from './plugins/transforms/sanity-to-html.js';
import sanityToMd from './plugins/transforms/sanity-to-markdown.js';
import sanityToPlain from './plugins/transforms/sanity-to-plain.js';

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
	 * @param {import('./content-options.js').ResolvedContentOptions} options.config
	 * @param {import('@bluecadet/launchpad-utils/lib/log-manager.js').Logger} options.logger
	 */
	constructor(wrappee, { dataStore, config, logger }) {
		super(wrappee);
		this.#dataStore = dataStore;

		const legacyPlugins = createPluginsFromConfig(config, logger);

		if (legacyPlugins.length > 0) {
			this.add(legacyPlugins);
		}
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

/**
 * Backwards compatibility adapter for legacy configs.
 * @param {import('./content-options.js').ResolvedContentOptions} options
 * @param {import('@bluecadet/launchpad-utils/lib/log-manager.js').Logger} logger
 * @returns {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks>[]}
 */
function createPluginsFromConfig(options, logger) {
	const transforms = options.contentTransforms;

	/**
	 * @type {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<ContentHooks>[]}
	 */
	const plugins = [];

	if (Object.entries(transforms).length > 0) {
		logger.warn('The `contentTransforms` option is deprecated. Please use content plugins instead.');
	}

	Object.entries(transforms).forEach(([key, transform]) => {
		const transformArray = Array.isArray(transform) ? transform : [transform];

		for (const transform of transformArray) {
			switch (transform) {
				case 'markdownToHtml':
				case 'mdToHtml':
					plugins.push(mdToHtml({
						path: key,
						simplified: false
					}));
					break;
				case 'markdownToHtmlSimplified':
				case 'mdToHtmlSimplified':
					plugins.push(mdToHtml({
						path: key,
						simplified: true
					}));
					break;
				case 'sanityToPlain':
					plugins.push(sanityToPlain({
						path: key
					}));
					break;
				case 'sanityToMd':
				case 'sanityToMarkdown':
					plugins.push(sanityToMd({
						path: key
					}));
					break;
				case 'sanityToHtml':
					plugins.push(sanityToHtml({
						path: key
					}));
					break;
				default:
					throw new Error(`Unknown content transform type: ${transform}`);
			}
		}
	});

	return plugins;
}
