/**
 * @module launchpad-content/content-options
 */

import { SourceOptions } from './content-sources/content-source.js';

/**
 * Options for all content and media downloads. Each of these settings can also be configured per `ContentSource`.
 */
export class ContentOptions {
	static get DOWNLOAD_PATH_TOKEN() {
		return '%DOWNLOAD_PATH%';
	}
	
	static get TIMESTAMP_TOKEN() {
		return '%TIMESTAMP%';
	}
	
	constructor({
		sources = [],
		imageTransforms = [],
		contentTransforms = {},
		downloadPath = '.downloads/',
		credentialsPath = '.credentials.json',
		tempPath = `${ContentOptions.DOWNLOAD_PATH_TOKEN}/.tmp/`,
		backupPath = `${ContentOptions.DOWNLOAD_PATH_TOKEN}/.tmp-backup/`,
		keep = '',
		strip = '',
		backupAndRestore = true,
		maxConcurrent = 4,
		maxTimeout = 30000,
		clearOldFilesOnStart = false,
		clearOldFilesOnSuccess = true,
		ignoreCache = false,
		enableIfModifiedSinceCheck = true,
		enableContentLengthCheck = true,
		abortOnError = true,
		ignoreImageTransformErrors = true,
		ignoreImageTransformCache = false,
		forceClearTempFiles = true,
		...rest // Any additional custom arguments
	} = {}) {
		/**
		 * A list of content source options. This defines which content is downloaded from where.
		 * @type {Array<SourceOptions>}
		 * @default []
		 */
		this.sources = sources;
		
		/**
		 * A list of image transforms to apply to a copy of each downloaded image.
		 * @type {Array<Object<string, number>>}
		 * @default []
		 */
		this.imageTransforms = imageTransforms;
		
		/**
		 * A list of content transforms to apply to all donwloaded content.
		 * @type {Object<string, string>}
		 * @default {}
		 */
		this.contentTransforms = contentTransforms;
		
		/**
		 * The path at which to store all downloaded files.
		 * @type {string}
		 * @default '.downloads/'
		 */
		this.downloadPath = downloadPath;
		
		/**
		 * The path to the json containing credentials for all content sources.
		 * @type {string}
		 * @default '.credentials.json'
		 */
		this.credentialsPath = credentialsPath;
		
		/**
		 * Temp file directory path.
		 * @type {boolean}
		 * @default '%DOWNLOAD_PATH%/.tmp/'
		 */
		this.tempPath = tempPath;
		
		/**
		 * Temp directory path where all downloaded content will be backed up before removal.
		 * @type {boolean}
		 * @default '%DOWNLOAD_PATH%/.backups/'
		 */
		this.backupPath = backupPath;
		
		/**
		 * Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `'*.json|*.csv|*.xml|*.git*'`
		 * @type {boolean}
		 * @default ''
		 */
		this.keep = keep;
		
		/**
		 * Strips this string from all media file paths when saving them locally
		 * @type {string}
		 * @default ''
		 */
		this.strip = strip;
		
		/**
		 * Back up files before downloading and restore originals for all sources on failure of any single source.
		 * @type {boolean}
		 * @default true
		 */
		this.backupAndRestore = backupAndRestore;
		
		/**
		 * Max concurrent downloads.
		 * @type {number}
		 * @default 4
		 */
		this.maxConcurrent = maxConcurrent;
		
		/**
		 * Max request timeout in ms.
		 * @type {number}
		 * @default 30000
		 */
		this.maxTimeout = maxTimeout;
		
		/**
		 * Remove all existing files in dest dir when downloads succeed. Ignores files that match `keep`
		 * @type {boolean}
		 * @default true
		 */
		this.clearOldFilesOnSuccess = clearOldFilesOnSuccess;
		
		/**
		 * Will remove all existing files _before_ downloads starts. `false` will ensure that existing files are only deleted after a download succeeds.
		 * @type {boolean}
		 * @default false
		 */
		this.clearOldFilesOnStart = clearOldFilesOnStart;
		
		/**
		 * Will always download files regardless of whether they've been cached
		 * @type {boolean}
		 * @default false
		 */
		this.ignoreCache = ignoreCache;
		
		/**
		 * Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists.
		 * @type {boolean}
		 * @default true
		 */
		this.enableIfModifiedSinceCheck = enableIfModifiedSinceCheck;
		
		/**
		 * Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists.
		 * @type {boolean}
		 * @default true
		 */
		this.enableContentLengthCheck = enableContentLengthCheck;
		
		/**
		 * If set to `true`, errors will cause syncing to abort all remaining tasks immediately
		 * @type {boolean}
		 * @default true
		 */
		this.abortOnError = abortOnError;
		
		/** 
		 * Set to `true` to always re-generate transformed images, even if cached versions of the original and transformed image already exist.
		 * @type {boolean}
		 * @default false
		 */
		this.ignoreImageTransformCache = ignoreImageTransformCache;
		
		/** 
		 * Set to `false` if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to `true` will allow for non-image files to fail quietly.
		 * @type {boolean}
		 * @default true
		 */
		this.ignoreImageTransformErrors = ignoreImageTransformErrors;
		
		/**
		 * Set to `false` if you want to keep all contents of the tempPath dir before downloading
		 * @type {boolean}
		 * @default true
		 */
		this.forceClearTempFiles = forceClearTempFiles;
		
		// Allows for additional properties to be inherited
		Object.assign(this, rest);
	}
}

export default ContentOptions;
