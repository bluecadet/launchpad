import ContentOptions from './content-options.js';
import { DataFile } from './content-sources/content-result.js';
import mdToHtml from './plugins/md-to-html.js';
import sanityToHtml from './plugins/sanity-to-html.js';
import sanityToMd from './plugins/sanity-to-markdown.js';
import sanityToPlain from './plugins/sanity-to-plain.js';

/**
 * @typedef ContentHooks
 * @prop {() => void} onContentFetchSetup Called before a content source is fetched
 * @prop {(param: {dataFiles: DataFile[]}) => void} onContentFetchData Called when all content for a given source has been fetched
 * @prop {() => void} onContentFetchError Called when a content source fails to fetch
 */

/**
 * @typedef {import("@bluecadet/launchpad-utils/lib/plugin-driver.js").Plugin<ContentHooks>} ContentPlugin
 */

// hack to make sure typescript sees this file
export {};

/**
 * @param {ContentOptions} options
 * @returns {ContentPlugin[]}
 * @deprecated this is a temporary solution to add compatibility with the old config style. Once JS configs are supported, this will be removed.
 */
export function createPluginsFromConfig(options) {
	const transforms = options.contentTransforms;

	/**
   * @type {ContentPlugin[]}
   */
	const plugins = [];

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
