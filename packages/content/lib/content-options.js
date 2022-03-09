/**
 * @module content-options
 */

import Constants from './utils/constants.js';
import { SourceOptions } from './content-sources/content-source.js';

/**
 * Options for all content and media downloads.
 */
export class ContentOptions {
  constructor({
    credentialsPath = '.credentials.json',
    downloadPath = '.downloads/',
    tempPath = `${Constants.DOWNLOAD_PATH_TOKEN}/.tmp/`,
    backupPath = `${Constants.DOWNLOAD_PATH_TOKEN}/.backups/`,
    backupAndRestore = true,
    maxConcurrent = 4,
    clearOldFilesOnStart = false,
    clearOldFilesOnSuccess = true,
    keep = '',
    strip = '',
    ignoreCache = false,
    skipModifiedCheck = false,
    abortOnError = true,
    ignoreImageTransformErrors = true,
    forceClearTempFiles = true,
    sources = [],
    imageTransforms = [],
    contentTransforms = {},
    ...rest // Any additional custom arguments
  } = {}) {
    /**
     * The path to the json containing credentials for all content sources.
     * Defaults to '.credentials.json'
     * @type {string}
     */
    this.credentialsPath = credentialsPath;
    
    /**
     * The path at which to store all downloaded files. Defaults to '.downloads/'
     * @type {string}
     */
    this.downloadPath = downloadPath;
    
    /**
     * Temp file directory path. Defaults to `${Constants.DOWNLOAD_PATH_TOKEN}/.tmp/`
     * @type {boolean}
     */
    this.tempPath = tempPath;
    
    /**
     * Temp directory path where all downloaded content will be backed up before removal. Defaults to `${Constants.DOWNLOAD_PATH_TOKEN}/.tmp-backup/`
     * @type {boolean}
     */
    this.backupPath = backupPath;
    
    /**
     * Back up files before downloading and restore originals for all sources on failure of any single source.
     * @type {boolean}
     */
    this.backupAndRestore = backupAndRestore;
    
    /**
     * Max concurrent downloads.
     * @type {boolean}
     */
    this.maxConcurrent = maxConcurrent;
    
    /**
     * Remove all existing files in dest dir when downloads succeed. Ignores files that match `keep`
     * @type {boolean}
     */
    this.clearOldFilesOnSuccess = clearOldFilesOnSuccess;
    
    /**
     * Will remove all existing files _before_ downloads starts. Defaults to false so that existing files are only deleted after a download success.
     * @type {boolean}
     */
    this.clearOldFilesOnStart = clearOldFilesOnStart;
    
    /**
     * Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. '*.json|*.csv|*.xml|*.git*'
     * @type {boolean}
     */
    this.keep = keep;
    
    /**
     * Strips this string from all media file paths when saving them locally
     * @type {string}
     */
    this.strip = strip;
    
    /**
     * Will always download files regardless of whether they've been cached
     * @type {boolean}
     */
    this.ignoreCache = ignoreCache;
    
    /**
     * Ignores the HTTP if modified check and only compare cached files for their existance
     * @type {boolean}
     */
    this.skipModifiedCheck = skipModifiedCheck;
    
    /**
     * If set to true, errors will cause syncing to abort all remaining tasks immediately
     * @type {boolean}
     */
    this.abortOnError = abortOnError;
    
    /** 
     * Set to false if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to true will allow for non-image files to fail quietly.
     * @type {boolean}
     */
    this.ignoreImageTransformErrors = ignoreImageTransformErrors;
    
    /**
     * Set to false if you want to keep all contents of the tempPath dir before downloading
     * @type {boolean}
     */
    this.forceClearTempFiles = forceClearTempFiles;
    
    /**
     * A list of content source options
     * @type {Array<SourceOptions>}
     */
    this.sources = sources;
    
    /**
     * A list of image transforms to apply to a copy of each downloaded image
     * @type {Array<Object<string, number>>}
     */
    this.imageTransforms = imageTransforms;
    
    /**
     * A list of content transforms to apply to all donwloaded content
     * @type {Object<string, string>}
     */
    this.contentTransforms = contentTransforms;
    
    // Allows for additional properties to be inherited
		Object.assign(this, rest);
  }
}

export default ContentOptions;