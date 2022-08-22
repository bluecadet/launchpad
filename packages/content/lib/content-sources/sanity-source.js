/**
 * @module sanity-source
 */

import chalk from 'chalk';
import jsonpath from 'jsonpath';

import ContentSource, { SourceOptions } from './content-source.js';
import ContentResult from './content-result.js';
import Credentials from '../credentials.js';
import { Logger } from '@bluecadet/launchpad-utils';

import sanityClient from '@sanity/client';
import { toHTML } from '@portabletext/to-html';
import toMarkdown from '@sanity/block-content-to-markdown';

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
    combinePaginatedFiles = false,
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
    this.combinePaginatedFiles = combinePaginatedFiles;

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

    // Build and init the sanity Client to use here.
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
    // const result = new ContentResult();
    // console.log(this.config);

    let queryPromises = [];
    let customQueryPromises = [];

    for (const query of this.config.queries) {

      if (typeof query === 'string' || query instanceof String) {
        let query = '*[_type == "' + query + '" ]';
        const result = new ContentResult();

        queryPromises.push(await this._fetchPages(query, query, result, {
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
      return values;
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

    const pageNum = params.start / params.limit;
    const q = query + '[' + params.start + '..' + (params.start + params.limit - 1) + ']';
    const p = {};

    this.logger.debug(`Fetching page ${pageNum} of ${id}`);

    return this.client.fetch(q, p).then((content) => {

      if (!content || !content.length) {
        // If we are combining files, we do that here.
        if (this.config.combinePaginatedFiles) {
          result.collate(id);
        }

        // Empty result or no more pages left
        return Promise.resolve(result);
      }

      const fileName = `${id}-${pageNum.toString().padStart(this.config.pageNumZeroPad, '0')}.json`;

      content = this._processText(content);

      result.addDataFile(fileName, content);
      result.addMediaUrls(this._getMediaUrls(content));

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
   * @return @type {Array.<string>}
   */
  _getMediaUrls(content) {
    const contentUrls = jsonpath.query(content, '$..url');
    const mediaUrls = [];
    for (let contentUrl of contentUrls) {
      if (contentUrl.startsWith('/')) {
        const url = new URL(contentUrl, this.config.baseUrl);
        contentUrl = url.toString();
      }
      mediaUrls.push(contentUrl);
    }
    return mediaUrls;
  }

  _processText(content) {

    // Check for processing text.
    content.forEach((d, j) => {

      Object.keys(d).forEach(key => {

        if (Array.isArray(d[key]) && d[key][0]._type == 'block') {

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
        // if it's not a text block with children,
        // return nothing
        if (block._type !== 'block' || !block.children) {
          return ''
        }
        // loop through the children spans, and join the
        // text strings
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
