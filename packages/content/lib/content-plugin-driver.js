import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { DataFile } from './content-sources/content-result.js';
import mdToHtml from './plugins/md-to-html.js';
import sanityToHtml from './plugins/sanity-to-html.js';
import sanityToMd from './plugins/sanity-to-markdown.js';
import sanityToPlain from './plugins/sanity-to-plain.js';
import MediaDownloader from './utils/media-downloader.js';

/**
 * @typedef ContentHookContext
 * @prop {MediaDownloader} mediaDownloader
 * // TBD 
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & ContentHookContext} CombinedContentHookContext
 */

/**
 * @typedef ContentHooks
 * @prop {(ctx: CombinedContentHookContext, ) => void} onContentFetchSetup Called before a content source is fetched
 * @prop {(ctx: CombinedContentHookContext, param: {dataFiles: DataFile[]}) => void} onContentFetchData Called when all content for a given source has been fetched
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
	 * @type {MediaDownloader}
	 */
	#mediaDownloader;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<ContentHooks>} wrappee
	 * @param {object} options
	 * @param {MediaDownloader} options.mediaDownloader
	 * @param {import('./content-options.js').ResolvedContentOptions} options.config
	 * @param {import('@bluecadet/launchpad-utils/lib/log-manager.js').Logger} options.logger
	 */
	constructor(wrappee, { mediaDownloader, config, logger }) {
		super(wrappee);
		this.#mediaDownloader = mediaDownloader;

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
			mediaDownloader: this.#mediaDownloader
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
