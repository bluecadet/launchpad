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
 * @property {Array<Object<string, number>>} [imageTransforms] A list of image transforms to apply to a copy of each downloaded image.
 * @property {Object<string, string>} [contentTransforms] A list of content transforms to apply to all donwloaded content.
 * @property {string} [downloadPath] The path at which to store all downloaded files. Defaults to '.downloads/'.
 * @property {string} [tempPath] Temp file directory path. Defaults to '%DOWNLOAD_PATH%/.tmp/'.
 * @property {string} [backupPath] Temp directory path where all downloaded content will be backed up before removal. Defaults to '%TIMESTAMP%/.tmp-backup/'.
 * @property {string} [keep] Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `'*.json|*.csv|*.xml|*.git*'`
 * @property {string} [strip] Strips this string from all media file paths when saving them locally
 * @property {boolean} [backupAndRestore] Back up files before downloading and restore originals for all sources on failure of any single source. Defaults to true.
 * @property {number} [maxTimeout] Max request timeout in ms. Defaults to 30000.
 * @property {boolean} [abortOnError] If set to `true`, errors will cause syncing to abort all remaining tasks immediately. Defaults to true.
 * @property {boolean} [ignoreImageTransformCache] Set to `true` to always re-generate transformed images, even if cached versions of the original and transformed image already exist. Defaults to false.
 * @property {boolean} [ignoreImageTransformErrors] Set to `false` if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to `true` will allow for non-image files to fail quietly. Defaults to true.
 * @property {boolean} [forceClearTempFiles] Set to `false` if you want to keep all contents of the tempPath dir before downloading. Defaults to true.
 * @property {string} [encodeChars] Characters to encode in the path when saving files locally. Defaults to `<>:"|?*`. Applies to both content source paths and media download paths.
 */

/**
 * @satisfies {ContentOptions}
 */
export const CONTENT_OPTION_DEFAULTS = {
	sources: [],
	imageTransforms: [],
	contentTransforms: {},
	downloadPath: '.downloads/',
	tempPath: '%DOWNLOAD_PATH%/.tmp/',
	backupPath: '.tmp-backup/%TIMESTAMP%/',
	keep: '',
	strip: '',
	backupAndRestore: true,
	maxTimeout: 30000,
	abortOnError: true,
	ignoreImageTransformCache: false,
	ignoreImageTransformErrors: true,
	forceClearTempFiles: true,
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
 * @typedef {import('@bluecadet/launchpad-utils').BaseConfig & {content?: ContentOptions, plugins?: import('./content-plugin-driver.js').ContentPlugin[]}} ConfigWithContent
 */

/**
 * @param {ConfigWithContent} config 
 * @returns {ConfigWithContent}
 */
export function defineContentConfig(config) {
	return config;
}
