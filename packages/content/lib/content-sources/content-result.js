import path from 'node:path';

export class DataFile {
	/**
	 * The relative local path where the file should be saved.
	 * @type {string}
	 */
	localPath = '';
	/**
	 * The file contents to be saved.
	 * @type {unknown}
	 */
	content = '';

	/**
	 *
	 * @param {string} localPath
	 * @param {unknown} content
	 */
	constructor(localPath, content) {
		this.localPath = localPath;
		this.content = content;
	}

	/**
	 * Returns the raw content if it's already a string, otherwise returns the result of `JSON.stringify(this.content)`.
	 * @returns {string}
	 */
	getContentStr() {
		if (typeof this.content === 'string') {
			return this.content;
		} else if (this.content) {
			return JSON.stringify(this.content);
		} else {
			return '';
		}
	}
}
export class MediaDownload {
	/**
	 * @param {object} options
	 * @param {string} options.url
	 * @param {string} [options.localPath]
	 */
	constructor({
		url,
		localPath = undefined,
		...rest
	}) {
		/**
		 * The url to download
		 * @type {string}
		 */
		this.url = url;
		
		/**
		 * The path of this asset relative to this source's root asset dir.
		 * Can optionally be overriden to save this file at another location.
		 */
		this.localPath = localPath || MediaDownload.buildLocalPath(this.url);
		
		Object.assign(this, rest);
	}
	
	/**
	 * Returns a string unique to this URL and relative path.
	 * Helpful for checking against duplicate download tasks.
	 * @returns {string}
	 */
	getKey() {
		return `${this.url}_${this.localPath}`;
	}

	/**
	 * Given a full URL, build a unique path to save the file
	 * @param {string} url
	 * @returns {string}
	 */
	static buildLocalPath(url) {
		// Remove protocol and domain
		let urlPath = url.replace(/^[^:]+:\/\/[^\/]+/, '');
		
		// Remove leading slash if present
		if (urlPath.startsWith('/')) {
			urlPath = urlPath.slice(1);
		}

		// Use the OS path separator
		const localPath = urlPath.replace(/\//g, path.sep);
		
		return localPath;
	}
}

export class ContentResult {
	/**
	 * List of data files to save
	 * @param {Array<ContentResult>} results
	 */
	static combine(results) {
		const finalResult = results.reduce((previousValue, currentValue) => {
			previousValue.addDataFiles(currentValue.dataFiles);
			previousValue.addMediaDownloads(currentValue.mediaDownloads);
			return previousValue;
		}, new ContentResult());

		return finalResult;
	}

	/**
	 * List of data files to save
	 * @type {Array<DataFile>}
	 */
	dataFiles = [];

	/**
	 * List of media to download
	 * @type {Array<MediaDownload>}
	 */
	mediaDownloads = [];

	/**
	 * @param {Array<DataFile>} dataFiles All the data files and their contents that should be saved
	 * @param {Array<MediaDownload>} mediaDownloads All the media files that should be saved
	 */
	constructor(dataFiles = [], mediaDownloads = []) {
		this.dataFiles = dataFiles;
		this.mediaDownloads = mediaDownloads;
	}

	/**
	 *
	 * @param {string} localPath
	 * @param {unknown} content
	 */
	addDataFile(localPath, content) {
		this.dataFiles.push(new DataFile(localPath, content));
	}

	/**
	 *
	 * @param {Array<DataFile>} DataFiles
	 */
	addDataFiles(DataFiles) {
		this.dataFiles.push(...DataFiles);
	}

	/**
	 *
	 * @param {MediaDownload | string} urlOrDownload
	 */
	addMediaDownload(urlOrDownload) {
		if (typeof urlOrDownload === 'string') {
			urlOrDownload = new MediaDownload({
				url: urlOrDownload
			});
		}
		this.mediaDownloads.push(urlOrDownload);
	}

	/**
	 *
	 * @param {Iterable<MediaDownload>} files
	 */
	addMediaDownloads(files) {
		this.mediaDownloads.push(...files);
	}

	/**
	 *
	 * @param {string} id
	 */
	collate(id) {
		/**
		 * @type {Array<DataFile>}
		 */
		const initial = [];

		// Collect all data into 1 object.
		const collatedData = this.dataFiles.reduce((previousValue, currentValue) => {
			// error if the content isn't iterable
			if (!Array.isArray(currentValue.content)) {
				throw new Error(`Content for ${currentValue.localPath} is not iterable`);
			}

			return [...previousValue, ...currentValue.content];
		}, initial);

		// Remove old datafiles.
		this.dataFiles = [];

		const fileName = `${id}.json`;
		this.addDataFile(fileName, collatedData);
	}
}

export default ContentResult;
