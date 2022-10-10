/**
* @module sanity-source
*/

import chalk from 'chalk';
import jsonpath from 'jsonpath';

import sanityClient from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';
import toMarkdown from '@sanity/block-content-to-markdown';
import { toHTML } from '@portabletext/to-html';

import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';
import FileUtils from '../utils/file-utils.js';

/**
* Options for SanitySource
*/
export class SanityOptions extends SourceOptions {
  constructor({
    apiVersion = 'v2021-10-21',
    projectId = undefined,
    dataset = 'production',
    apiToken = undefined,
    useCdn = false,
    baseUrl = undefined,
    queries = [],
    textConverters = [],
    limit = 100,
    maxNumPages = -1,
    mergePages = false,
    pageNumZeroPad = 0,
    ...rest
  } = {}) {
    
    super(rest);
    
    /**
    * API Version
    * @type {string}
    */
    this.apiVersion = apiVersion;
    
    /**
    * Sanity Project ID
    * @type {string}
    */
    this.projectId = projectId;
    
    /**
    * API Version
    * @type {string}
    */
    this.dataset = dataset;
    
    /**
    * `false` if you want to ensure fresh data
    * @type {string}
    */
    this.useCdn = useCdn;
    
    /**
    * The base url of your Sanity CMS (with or without trailing slash).
    * @type {string}
    */
    this.baseUrl = baseUrl;
    
    /**
    *
    * @type {Array.<string>}
    */
    this.queries = queries;
    
    /**
    *
    * @type {Array.<string>}
    */
    this.textConverters = textConverters;
    
    /**
    * Max number of entries per page. Default is 100.
    * @type {number}
    */
    this.limit = limit;
    
    /**
    * Max number of pages. Default is -1 for all pages
    * @type {number}
    */
    this.maxNumPages = maxNumPages;
    
    /**
    * To combine paginated files into 1 file.
    * @type {boolean}
    */
    this.mergePages = mergePages;
    
    /**
    * How many zeros to pad each json filename index with. Default is 0
    * @type {number}
    */
    this.pageNumZeroPad = pageNumZeroPad;
    
    /**
    * API Token defined in your sanity project.
    * @type {string}
    */
    this.apiToken = apiToken;
  }
}

class SanitySource extends ContentSource {
  /**
  *
  * @param {*} config
  * @param {Logger} logger
  */
  constructor(config, logger) {
    super(SanitySource._assembleConfig(config), logger);
    this.client = sanityClient({
      projectId: this.config.projectId,
      dataset: this.config.dataset,
      apiVersion: this.config.apiVersion, // use current UTC date - see "specifying API version"!
      token: this.config.apiToken, // or leave blank for unauthenticated usage
      useCdn: this.config.useCdn, // `false` if you want to ensure fresh data
    });
  }
  
  /**
  * @returns {Promise<ContentResult>}
  */
  async fetchContent() {
    
    let queryPromises = [];
    let customQueryPromises = [];
    
    for (const query of this.config.queries) {
      
      if (typeof query === 'string' || query instanceof String) {
        let queryFull = '*[_type == "' + query + '" ]';
        const result = new ContentResult();
        
        queryPromises.push(await this._fetchPages(query, queryFull, result, {
          start: 0,
          limit: this.config.limit
        }));
      }
      else {
        const result = new ContentResult();
        customQueryPromises.push(await this._fetchPages(query.id, query.query, result, {
          start: 0,
          limit: this.config.limit
        }));
      }
    }
    
    return Promise.all([...queryPromises, ...customQueryPromises]).then((values) => {
      
      return ContentResult.combine(values);
    }).catch((error) => {
      this.logger.error(`Sync failed: ${error ? error.message || '' : ''}`);
      return error;
    });
  }
  
  /**
  * Recursively fetches content using the Sanity client.
  *
  * @param {string} id
  * @param {string} query
  * @param {string} jwt The JSON web token generated by Sanity
  * @param {ContentResult} result
  * @param {Object} params
  * @returns {Promise<Object>} Object with an 'entries' and an 'assets' array.
  */
  async _fetchPages(
    id,
    query,
    result,
    params = {start: 0, limit: 100},
    ) {
      const pageNum = params.start / params.limit || 0;
      const q = query + '[' + params.start + '..' + (params.start + params.limit - 1) + ']';
      const p = {};
      
      this.logger.debug(`Fetching page ${pageNum} of ${id}`);
      
      return this.client.fetch(q, p).then((content) => {
        
        if (!content || !content.length) {
          // If we are combining files, we do that here.
          if (this.config.mergePages) {
            result.collate(id);
          }
          
          // Empty result or no more pages left
          return Promise.resolve(result);
        }
        
        const fileName = `${id}-${pageNum.toString().padStart(this.config.pageNumZeroPad, '0')}.json`;
        
        // Check for Sanity Text Converters.
        if (this.config.textConverters.length > 0) {
          content = this._processText(content);
        }
        
        result.addDataFile(fileName, content);
        result.addMediaDownloads(this._getMediaDownloads(content));
        
        if (this.config.maxNumPages < 0 || pageNum < this.config.maxNumPages - 1) {
          // Fetch next page
          params.start = params.start || 0;
          params.start += params.limit;
          return this._fetchPages(id, query, result, params);
        } else {
          // Return combined entries + assets
          return Promise.resolve(result);
        }
      })
      .catch((error) => {
        this.logger.error(chalk.red(`Could not fetch page: ${error ? error.message || '' : ''}`));
        return Promise.reject(error);
      });
    }
    
    /**
    *
    * @param {Object} content
    * @return @type {Array.<MediaDownload>}
    */
   _getMediaDownloads(content) {
      const downloads = [];
      
      // Get all raw URLs
      const rawAssetUrls = jsonpath.query(content, '$..url');
      for (let contentUrl of rawAssetUrls) {
        if (contentUrl.startsWith('/')) {
          const url = new URL(contentUrl, this.config.baseUrl);
          contentUrl = url.toString();
        }
        downloads.push(new MediaDownload({
          url: contentUrl
        }));
      }
      
      // Get derivative image URLs for crops/hotspots/etc
      const images = jsonpath.query(content, '$..*[?(@._type=="image")]');
      const builder = imageUrlBuilder(this.client)
      for (let image of images) {
        if (!image._key) {
          // _key is only defined for derivative images. Skip if it doesn't exist
          continue;
        }
        const urlBuilder = builder.image(image);
        const task = new MediaDownload({
          url: urlBuilder.url()
        });
        task.localPath = FileUtils.addFilenameSuffix(task.localPath, `_${image._key}`);
        downloads.push(task);
      }
      
      return downloads;
    }
    
    _processText(content) {
      // Check for processing text.
      // TODO: Refactor to use jsonpath
      content.forEach((d, j) => {
        Object.keys(d).forEach(key => {
          if (
            Array.isArray(d[key])
            && d[key].length > 0
            && d[key][0].hasOwnProperty('_type')
            && d[key][0]._type == 'block'
            ) {
              this.config.textConverters.forEach((el, i) => {
                switch (el) {
                  case 'toPlainText':
                  content[j][key + '_toPlainText'] = this._toPlainText(d[key]);
                  break;
                  case 'toHtml':
                  content[j][key + '_toHtml'] = toHTML(d[key]);
                  break;
                  case 'toMarkdown':
                  content[j][key + '_toMarkdown'] = toMarkdown(d[key]);
                  break;
                  default:
                  this.logger.warn(`Bad Sanity Text converter: ${el}`);
                }
              });
            }
          });
        });
        return content;
      }
      
      _toPlainText(blocks = []) {
        return blocks
        // loop through each block
        .map(block => {
          // if it's not a text block with children, return nothing
          if (block._type !== 'block' || !block.children) {
            return ''
          }
          // loop through the children spans, and join the text strings
          return block.children.map(child => child.text).join('')
        })
        // join the paragraphs leaving split by two linebreaks
        .join('\n\n')
      }
      
      /**
      *
      * @param {*} config
      * @returns {SanityOptions}
      */
      static _assembleConfig(config) {
        return new SanityOptions({
          ...config,
          ...Credentials.getCredentials(config.id),
        });
      }
    }
    
    export default SanitySource;
    