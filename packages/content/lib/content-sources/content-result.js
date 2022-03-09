class ContentResultDataFile {
  /**
	 * The relative local path where the file should be saved.
   * @type {string}
   */
  localPath = '';
  /**
	 * The file contents to be saved.
   * @type {*}
   */
  content = '';
	
	/**
	 * 
	 * @param {string} localPath 
	 * @param {string|JSON|Object|Array} content 
	 */
	constructor(localPath, content) {
		this.localPath = localPath;
		this.content = content;
	}
	
	/**
	 * Returns the raw content if it's already a string,
	 * otherwise returns the result of JSON.stringify(this.content).
	 * @returns {string}
	 */
	getContentStr() {
		if ((typeof this.content) === 'string') {
			return this.content;
		} else if (this.content) {
			return JSON.stringify(this.content);
		} else {
			return '';
		}
	}
}

class ContentResult {
  /**
   * List of data files to save
   * @type {Array<ContentResultDataFile>}
   */
  dataFiles = [];

  /**
   * List of URLs to download
   * @type {Array<string>}
   */
  mediaUrls = [];
	
	/**
	 * @param {Array<ContentResultDataFile>} dataFiles All the data files and their contents that should be saved
	 * @param {Array<string>} mediaUrls All the media files that should be saved
	 */
	constructor(dataFiles = [], mediaUrls = []) {
		this.dataFiles = dataFiles;
		this.mediaUrls = mediaUrls;
	}
	
	/**
	 * 
	 * @param {string} localPath 
	 * @param {*} content 
	 */
	addDataFile(localPath, content) {
		this.dataFiles.push(new ContentResultDataFile(localPath, content));
	}
	
	/**
	 * 
	 * @param {string} url 
	 */
	addMediaUrl(url) {
		this.mediaUrls.push(url);
	}
	
	/**
	 * 
	 * @param {Iterable} files 
	 */
	addMediaUrls(files) {
		this.mediaUrls.push(...files);
	}
}

export default ContentResult;