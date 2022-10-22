/**
 * @module contentful-source
 */

import contentful from 'contentful';
import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult, { MediaDownload } from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * Configuration options for the Contentful ContentSource.
 * 
 * Also supports all fields of the Contentful SDK's config.
 * 
 * @see 'Configuration' under https://contentful.github.io/contentful.js/contentful/9.1.7/
 */
export class ContentfulOptions extends SourceOptions {
  constructor({
    space = '',
    locale = 'en-US',
    filename = 'content.json',
    protocol = 'https',
    host = 'cdn.contentful.com',
    usePreviewApi = false,
    contentTypes = null,
    searchParams = {
      limit: 1000, // This is the max that Contentful supports,
      include: 10, // @see https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/links/retrieval-of-linked-items
    },
    imageParams = {},
    accessToken = '',
    deliveryToken = '',
    previewToken = '',
    ...rest
  } = {}) {
    super(rest);
    
    /**
     * Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this
     * @type {string}
     * @default ''
     */
    this.space = space;
    
    /**
     * Optional. Used to pull localized images.
     * @type {string}
     * @default 'en-US'
     */
    this.locale = locale;
    
    /**
     * Optional. The filename you want to use for where all content (entries and assets metadata) will be stored.
     * @type {string}
     * @default 'content.json'
     */
    this.filename = filename;
    
    /**
     * Optionally limit queries to these content types.
     * This will also apply to linked assets.
     * Types that link to other types will include up to 10 levels of child content.
     * E.g. filtering by Story, might also include Chapters and Images.
     * Uses `searchParams['sys.contentType.sys.id[in]']` under the hood.
     * @type {Array<string>}
     */
    this.contentTypes = contentTypes;
    
    /**
     * Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters
     * @type {Object}
     */
    this.searchParams = searchParams;
    
    /**
     * Optional. Applies to all images. Defaults to empty object.
     * **IMPORTANT:** If you change the parameters, you will have to delete all cached images since the modified date of the original image will not have changed.
     * @see https://www.contentful.com/developers/docs/references/images-api/#/reference/resizing-&-cropping/specify-focus-area
     * @type {Object}
     */
    this.imageParams = imageParams;
    
    /**
     * Optional
     * @type {string}
     * @default 'https'
     */
    this.protocol = protocol;
    
    /**
     * Optional
     * @type {string}
     * @default 'cdn.contentful.com'
     */
    this.host = host;
    
    /**
     * Optional. Set to true if you want to use the preview API instead of the production version to view draft content.
     * @type {boolean}
     * @default false
     */
    this.usePreviewApi = usePreviewApi;
    
    /**
     * Content delivery token (all published content).
     * @type {string}
     */
    this.deliveryToken = deliveryToken;
    
    /**
     * Content preview token (only unpublished/draft content).
     * @type {string}
     */
    this.previewToken = previewToken;
    
    /**
     * LEGACY: For backwards compatibility you can only set the `"accessToken"` using your delivery or preview token and a combination of the usePreviewApi flag.
     * @type {string}
     */
    this.accessToken = accessToken;
  }
}

class ContentfulSource extends ContentSource {
  /** @type {contentful.ContentfulClientApi} */
  client = null;

  /**
   * @param {*} config 
   * @param {Logger} logger 
   */
  constructor(config, logger) {
    super(ContentfulSource._assembleConfig(config), logger);
    if (this.config.usePreviewApi) {
      this.logger.info(`Using preview API for Contentful source '${this.config.id}'`);
    }
    this.client = contentful.createClient(this.config);
  }

  /**
   * @returns {Promise<ContentResult>}
   */
  async fetchContent() {
    return this._fetchPage(this.config.searchParams)
      .then((content) => {
        const result = new ContentResult();
        result.addDataFile(this.config.filename, content);
        result.addMediaDownloads(
          this._getMediaUrls(content.assets).map(url => new MediaDownload({url}))
        );
        return result;
      })
      .catch((err) => {
        return Promise.reject(`Could not fetch Contentful content: ${err.message}`);
      });
  }

  /**
   * Recursively fetches content using the Contentful client.
   *
   * @param {*} searchParams
   * @param {*} result
   * @returns {*} Object with an 'entries' and an 'assets' array.
   */
  async _fetchPage(searchParams = {}, result = {}) {
    result.entries = result.entries || [];
    result.assets = result.assets || [];
    result.numPages = result.numPages || 0;

    return (
      this.client
        .getEntries(searchParams)
        .then((rawPage) => {
          const page = rawPage.toPlainObject();
          result.numPages++;
          result.entries.push(...this._parseEntries(page));
          result.assets.push(...this._parseAssets(page));
          
          if (page.limit + page.skip < page.total) {
            // Fetch next page
            searchParams.skip = searchParams.skip || 0;
            searchParams.skip += page.limit;
            return this._fetchPage(searchParams, result);
          } else {
            // Return combined entries + assets
            return Promise.resolve(result);
          }
        })
        .catch((error) => {
          this.logger.error(`Sync failed: ${error ? error.message || '' : ''}`);
        })
    );
  }

  /**
   * Returns all entries from a sync() or getEntries() response object.
   * @param {*} responseObj 
   * @returns {Array<contentful.Entry>} Array of entry objects.
   */
  _parseEntries(responseObj) {
    const entries = responseObj.entries || [];
    if (responseObj.items) {
      for (const item of responseObj.items) {
        if (item && item.sys && item.sys.type === 'Entry') {
          entries.push(item);
        }
      }
    }
    return entries;
  }
  
  /**
   * Returns all entries from a sync() or getEntries() response object.
   * @param {*} responseObj 
   * @returns {Array<contentful.Asset>} Array of entry objects.
   */
  _parseAssets(responseObj) {
    const assets = responseObj.assets || [];
    if (responseObj.includes) {
      // 'includes' is an object where the key = type, and the value = list of items
      for (const [key, items] of Object.entries(responseObj.includes)) {
        if (key === 'Asset') {
          assets.push(...items);
        }
      }
    }
    return assets;
  }

  /**
   * Extracts all media urls from a list of Contentful asset objects
   * @param {*} assets The list of assets from the Contentful API
   * @returns {Array<string>}
   */
  _getMediaUrls(assets) {
    const urls = [];

    for (const asset of assets) {
      if (asset.fields && asset.fields.file) {
        const file = asset.fields.file;
        const locale = this.config.locale;

        let url = '';

        if (!file) {
          this.logger.error(file);
        } else if (locale && file[locale] && file[locale].url) {
          url = file[locale].url;
        } else if (file && file.url) {
          url = file.url;
        }
        
        if (!url) {
          continue;
        }

        if (!url.includes('http') && !url.includes('https')) {
          url = `${this.config.protocol}:${url}`;
        }
        
        
        if (this.config.imageParams) {
          for (const [key, value] of Object.entries(this.config.imageParams)) {
            url += (url.includes('?') ? '&' : '?') + `${key}=${value}`;
          }
        }
        urls.push(url);
      }
    }
    
    return urls;
  }

  static _assembleConfig(config) {
    config = new ContentfulOptions({
      ...config,
      ...Credentials.getCredentials(config.id),
    });
    
    if (config.usePreviewApi || (!config.accessToken && !config.deliveryToken && config.previewToken)) {
      config.host = 'preview.contentful.com';
      config.usePreviewApi = true;
    }
    
    if (!config.accessToken) {
      config.accessToken = config.usePreviewApi ? config.previewToken : config.deliveryToken;
    }

    if (config.contentTypes && config.contentTypes.length > 0) {
      config.searchParams['sys.contentType.sys.id[in]'] = config.contentTypes.join(',');
    }

    return config;
  }
}

export default ContentfulSource;
