/**
 * @module json-source
 */

import JsonUtils from '../utils/json-utils.js';
import ContentSource, { MEDIA_REGEX } from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import got from 'got';
import { Logger } from '@bluecadet/launchpad-utils';
import chalk from 'chalk';

/**
 * @typedef BaseJsonOptions
 * @property {RegExp} [mediaPattern] Regex for media files that should be downloaded from json sources. Defaults to `/.+(\.jpg|\.jpeg|\.png)/gi|/.+(\.avi|\.mov|\.mp4|\.mpg|\.mpeg)/gi`
 * @property {Record<string, string>} files A mapping of json file-path -> url
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'json'> & BaseJsonOptions} JsonOptions
 */

/**
 * @typedef {import('./content-source.js').SourceOptions<'json'> & Required<BaseJsonOptions>} JsonOptionsAssembled
 */

const JSON_OPTIONS_DEFAULTS = {
	mediaPattern: MEDIA_REGEX
};

/**
 * @extends {ContentSource<JsonOptionsAssembled>}
 */
class JsonSource extends ContentSource {
	/**
	 * 
	 * @param {JsonOptions} config 
	 * @param {Logger} logger 
	 */
	constructor(config, logger) {
		super({ ...JSON_OPTIONS_DEFAULTS, ...config }, logger);
	}
	
	/**
	 * @returns {Promise<ContentResult>} 
	 */
	async fetchContent() {
		return this._downloadJsons().then((result) => {
			return this._scrapeMediaUrls(result);
		});
	}

	/**
	 * @return {Promise<ContentResult>}
	 */
	async _downloadJsons() {
		const result = new ContentResult();
		
		for (const [path, url] of Object.entries(this.config.files)) {
			this.logger.debug(`Downloading json ${chalk.blue(url)}`);
			const response = await got(url);
			const json = JSON.parse(response.body);
			result.addDataFile(path, json);
		}
		
		return result;
	}
	
	/**
	 * 
	 * @param {ContentResult} result
	 * @returns {Promise<ContentResult>}
	 */
	async _scrapeMediaUrls(result) {
		for (const dataFile of result.dataFiles) {
			this.logger.debug(`Scraping for media files in ${chalk.blue(dataFile.localPath)}...`);
			const mediaUrls = JsonUtils.getUrls(dataFile.content, undefined, this.config.mediaPattern);
			this.logger.debug(`Found ${chalk.blue(mediaUrls.size)} media files in ${chalk.blue(dataFile.localPath)}`);
			result.addMediaDownloads([...mediaUrls].map(url => new MediaDownload({ url })));
		}
		return result;
	}
}

export default JsonSource;
