/**
 * @module json-source
 */

import Constants from '../utils/constants.js';
import JsonUtils from '../utils/json-utils.js';
import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult from './content-result.js';
import got from 'got';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * Options for JsonSource
 */
export class JsonOptions extends SourceOptions {
  constructor({
    mediaPattern = Constants.MEDIA_REGEX,
    files = {},
    ...rest
  } = {}) {
    super(rest);
    
    /**
     * Regex for media files that should be downloaded from json sources
     * @type {RegExp}
     */
    this.mediaPattern = new RegExp(mediaPattern);
    
    /**
     * A mapping of json file-path -> url
     * @type {Object<string,string>}
     */ 
    this.files = files;
  }
}

class JsonSource extends ContentSource {
  
  /**
   * 
   * @param {*} config 
   * @param {Logger} logger 
   */
  constructor(config, logger) {
    super(new JsonOptions(config), logger);
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
   * @return {ContentResult}
   */
  async _downloadJsons() {
    const result = new ContentResult();
    
    for (const [path, url] of Object.entries(this.config.files)) {
      const response = await got(url);
      const json = JSON.parse(response.body);
      result.addDataFile(path, json);
    }
    
    return result;
  }
  
  /**
   * 
   * @param {ContentResult} result
   * @returns {ContentResult}}
   */
  async _scrapeMediaUrls(result) {
    for (const dataFile of result.dataFiles) {
      const mediaUrls = JsonUtils.getUrls(dataFile.content, null, this.config.mediaPattern);
      result.addMediaUrls(mediaUrls);
    }
    return result;
  }
}

export default JsonSource;
