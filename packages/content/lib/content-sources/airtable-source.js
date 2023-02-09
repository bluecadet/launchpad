/**
 * @module airtable-source
 */

import Airtable from 'airtable';
// eslint-disable-next-line no-unused-vars
import { Logger } from '@bluecadet/launchpad-utils';
import { ContentSource, SourceOptions } from './content-source';
import { ContentResult, MediaDownload } from './content-result';
import Credentials from '../credentials';

/**
 * Options for AirtableSource
 */
export class AirtableOptions extends SourceOptions {
  constructor({
    baseId = undefined,
    tables = [],
    keyValueTables = [],
    defaultView = 'Grid view',
    endpointUrl = 'https://api.airtable.com',
    appendLocalAttachmentPaths = true,
    ...rest
  } = {}) {
    super(rest);

    /**
     * Airtable base ID. @see https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base.
     * @type {string}
     */
    this.baseId = baseId;

    /**
     * @type {string}
     * @default 'Grid view'
     */
    this.defaultView = defaultView;

    /**
     * The tables you want to fetch from
     * @type {string}
     * @default []
     */
    this.tables = tables;

    /**
     * As a convenience feature, you can store tables listed here as
     * key/value pairs. Field names should be `"key"` and `"value"`.
     * @type {string}
     * @default []
     */
    this.keyValueTables = keyValueTables;

    /**
     * The API endpoint to use for Airtable
     * @type {string}
     * @default 'https://api.airtable.com'
     */
    this.endpointUrl = endpointUrl;

    /**
     * The table view which to select for syncing by default
     * @type {string}
     */
    this.defaultView = defaultView;

    /**
     * Appends the local path of attachments to the saved JSON
     * @type {boolean}
     * @default true
     */
    this.appendLocalAttachmentPaths = appendLocalAttachmentPaths;
  }
}

export class AirtableSource extends ContentSource {
  /** @type {Airtable.Base} */
  _base = null;

  _rawAirtableData = {};

  _simplifiedData = {};

  /**
   *
   * @param {*} config
   * @param {Logger} logger
   */
  constructor(config, logger) {
    super(new AirtableOptions(config), logger);

    const credentials = Credentials.getCredentials(this.config.id);

    if (!credentials.apiKey) {
      throw new Error(`No Airtable API Key for '${this.config.id}'`);
    }

    Airtable.configure({
      endpointUrl: this.config.endpointUrl,
      apiKey: credentials.apiKey,
    });

    this._base = Airtable.base(this.config.baseId);
    this._base.makeRequest();
  }

  /**
   * @returns {Promise<ContentResult>}
   */
  async fetchContent() {
    const result = new ContentResult();
    const tablePromises = [];

    for (const tableId of this.config.tables) {
      tablePromises.push(this._getData(tableId));
    }
    for (const tableId of this.config.keyValueTables) {
      tablePromises.push(this._getData(tableId));
    }

    return Promise.all(tablePromises)
      .then(async () => {
        for (const tableId of this.config.tables) {
          await this._processTable(tableId, false, result);
        }
        for (const tableId of this.config.keyValueTables) {
          await this._processTable(tableId, true, result);
        }
      })
      .then(() => result);
  }

  /**
   *
   * @param {string} tableId
   * @param {boolean} isKeyValueTable
   * @param {ContentResult} result
   * @returns {ContentResult}
   */
  async _processTable(tableId, isKeyValueTable = false, result = new ContentResult()) {
    // Write raw Data file.

    const rawDataPath = `${tableId}.raw.json`;
    result.addDataFile(rawDataPath, this._rawAirtableData[tableId]);

    const simpData = isKeyValueTable ? {} : [];
    this._simplifiedData[tableId] = [];

    // Process simplified data
    for (const row of this._rawAirtableData[tableId]) {
      const fields = { ...row._rawJson.fields };

      if (isKeyValueTable) {
        if (Object.keys(row).length < 2) {
          this.logger.error(
            `Table ${tableId} requires at least 2 columns to map it to a key-value pair.`,
          );
          return result;
        }

        const regex = /(.*)\[([0-9]*)\]$/g;
        // Default to "key" | "value" if available.
        const keyField = Object.keys(fields).includes('key') ? 'key' : Object.keys(fields)[0];
        const valueField = Object.keys(fields).includes('value') ? 'value' : Object.keys(fields)[1];
        const key = fields[keyField];
        const value = fields[valueField];

        const matches = key ? [...key.matchAll(regex)] : [];
        if (matches.length > 0) {
          if (!simpData[matches[0][1]]) {
            simpData[matches[0][1]] = [];
          }
          simpData[matches[0][1]][matches[0][2]] = value;
        } else if (this._isNumericStr(value)) {
          simpData[key] = parseFloat(value);
        } else if (this._isBoolStr(value)) {
          simpData[key] = value === 'true';
        } else {
          simpData[key] = value;
        }
      } else {
        simpData.push({ id: row.id, ...fields });
      }
    }

    this._simplifiedData[tableId] = simpData;

    // Gather attachments
    if (!isKeyValueTable) {
      result.addMediaDownloads(
        this._getMediaUrls(simpData).map((url) => new MediaDownload({ url })),
      );
    }

    const simpDataPath = `${tableId}.json`;
    result.addDataFile(simpDataPath, this._simplifiedData[tableId]);

    return result;
  }

  _isBoolStr(str) {
    return str === 'true' || str === 'false';
  }

  _isNumericStr(str) {
    return !isNaN(str);
  }

  // Get Data.
  async _getData(table, force = false) {
    // If force, clear the data.
    if (force) {
      this._rawAirtableData[table] = [];
    }

    if (this._rawAirtableData[table] && this._rawAirtableData[table].length > 0) {
      // Return cached data
      return Promise.resolve(this._rawAirtableData[table]);
    }
    // Fetch new data
    return this._fetchData(table).then((tableData) => {
      this._rawAirtableData[table] = tableData;
      return this._rawAirtableData[table];
    });
  }

  // Fetch from Airtable.
  async _fetchData(table) {
    return new Promise((resolve, reject) => {
      const rows = [];

      this._base(table)
        .select({
          view: this.config.defaultView,
        })
        .eachPage(
          (records, fetchNextPage) => {
            // This function (`page`) will get called for each page of records.
            records.forEach((record) => {
              rows.push(record);
            });

            // To fetch the next page of records, call `fetchNextPage`.
            // If there are more records, `page` will get called again.
            // If there are no more records, `done` will get called.
            fetchNextPage();
          },
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          },
        );
    });
  }

  /**
   *
   * @param {*} tableData
   * @returns {Array<string>} media urls
   */
  _getMediaUrls(tableData) {
    const urls = [];
    // Loop through all records, for filename fields.
    for (const row of tableData) {
      for (const colId of Object.keys(row)) {
        // We assume it is a file if value is an array and `filename` key exists.
        if (Array.isArray(row[colId]) && row[colId][0].filename) {
          for (const attachment of row[colId]) {
            const url = new URL(attachment.url);
            if (this.config.appendLocalAttachmentPaths) {
              attachment.localPath = url.pathname;
            }
            urls.push(url.toString());
          }
        }
      }
    }
    return urls;
  }
}

export default AirtableSource;
