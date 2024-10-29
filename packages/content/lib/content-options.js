/**
 * @module launchpad-content/content-options
 */

export const DOWNLOAD_PATH_TOKEN = '%DOWNLOAD_PATH%';

export const TIMESTAMP_TOKEN = '%TIMESTAMP%';

/**
 * @typedef {import('./sources/source.js').ContentSource
 * | Promise<import('./sources/source.js').ContentSource>
 * | import('neverthrow').ResultAsync<import('./sources/source.js').ContentSource, import('./sources/source-errors.js').SourceError>
 * } ConfigContentSource
 */

/**
 * @typedef ContentOptions
 * @property {ConfigContentSource[]} [sources] A list of content source options. This defines which content is downloaded from where.
 * @property {string} [downloadPath] The path at which to store all downloaded files. Defaults to '.downloads/'.
 * @property {string} [tempPath] Temp file directory path. Defaults to '%DOWNLOAD_PATH%/.tmp/'.
 * @property {string} [backupPath] Temp directory path where all downloaded content will be backed up before removal. Defaults to '%TIMESTAMP%/.tmp-backup/'.
 * @property {Array<string>} [keep] Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `['*.json', '** /*.csv', '*.xml', '*.git*']`
 * @property {string} [strip] Strips this string from all media file paths when saving them locally
 * @property {boolean} [backupAndRestore] Back up files before downloading and restore originals for all sources on failure of any single source. Defaults to true.
 * @property {number} [maxTimeout] Max request timeout in ms. Defaults to 30000.
 * @property {string} [encodeChars] Characters to encode in the path when saving files locally. Defaults to `<>:"|?*`. Applies to both content source paths and media download paths.
 */

/**
 * @satisfies {ContentOptions}
 */
export const CONTENT_OPTION_DEFAULTS = {
	sources: [],
	downloadPath: '.downloads/',
	tempPath: '%DOWNLOAD_PATH%/.tmp/',
	backupPath: '.tmp-backup/%TIMESTAMP%/',
	keep: [],
	strip: '',
	backupAndRestore: true,
	maxTimeout: 30000,
	encodeChars: '<>:"|?*'
};

/**
 * Apply defaults to passed content config
 * @param {ContentOptions} [config]
 */
export function resolveContentOptions(config) {
	return {
		...CONTENT_OPTION_DEFAULTS,
		...config
	};
}

/**
 * @typedef {ReturnType<typeof resolveContentOptions>} ResolvedContentOptions
 */

/**
 * @typedef {{content?: ContentOptions, plugins?: import('./content-plugin-driver.js').ContentPlugin[]}} ConfigWithContent
 */

/**
 * @param {ConfigWithContent} config 
 * @returns {ConfigWithContent}
 */
export function defineContentConfig(config) {
	return config;
}
