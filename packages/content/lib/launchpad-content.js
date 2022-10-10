import path from 'path';
import jsonpath from 'jsonpath';
import chalk from 'chalk';
import fs from 'fs-extra';

import Credentials from './credentials.js';
import ContentOptions from './content-options.js';

import ContentSource from './content-sources/content-source.js';
import AirtableSource from './content-sources/airtable-source.js';
import JsonSource from './content-sources/json-source.js';
import ContentfulSource from './content-sources/contentful-source.js';
import StrapiSource from './content-sources/strapi-source.js';
import SanitySource from './content-sources/sanity-source.js';

import MediaDownloader from './utils/media-downloader.js';
import FileUtils from './utils/file-utils.js';
import Constants from './utils/constants.js';
import MdToHtmlTransform from './content-transforms/md-to-html-transform.js';
import ContentTransform from './content-transforms/content-transform.js';

import { LogManager, Logger } from '@bluecadet/launchpad-utils';
import ContentResult from './content-sources/content-result.js';

export class ContentSourceTypes {
  static json = 'json';
  static airtable = 'airtable';
  static contentful = 'contentful';
  static sanity = 'sanity';
  static strapi = 'strapi';
}

export class LaunchpadContent {
  /**
   * Creates a new LaunchpadContent and downloads content using an optional user config object.
   * @param {ContentOptions} config
   * @returns {Promise.<LaunchpadContent>} Promise that resolves with the new LaunchpadContent instance.
   */
  static async createAndDownload(config = null) {
    try {
      const content = new LaunchpadContent(config);
      await content.download();
      return content;
    } catch (error) {
      LogManager.getInstance().getLogger().error(
        chalk.red('Could not download data:'),
        error
      );
      return Promise.reject(error);
    }
  }
  
  /** @type {ContentOptions} */
  _config = null;
  
  /** @type {Logger} */
  _logger = null;
  
  /** @type {Array.<ContentSource>} */
  _sources = [];
  
  /** @type {MediaDownloader} */
  _mediaDownloader = null;
  
  /** @type {Map<string, ContentTransform>} */
  _contentTransforms = new Map();

  /**
   * @param {ContentOptions|Object} config
   * @param {Logger} parentLogger
   */
  constructor(config, parentLogger = null) {
    this._config = new ContentOptions(config);
    this._logger = LogManager.getInstance().getLogger('content', parentLogger);
    this._mediaDownloader = new MediaDownloader(this._logger);
    this._contentTransforms.set('mdToHtml', new MdToHtmlTransform(false));
    this._contentTransforms.set('mdToHtmlSimplified', new MdToHtmlTransform(true));
    
    if (this._config.credentialsPath) {
      try {
        Credentials.init(this._config.credentialsPath, this._logger);
      } catch (err) {
        this._logger.warn(`Could not load credentials:`, err.message);
      }
    }
    
    this.sources = this._createSources(this._config.sources);
		// onExit(() => {
    //   // TODO: Abort media downloader and wait for remaining downloads to finish
    // });
  }

  /**
   * @param {Array<ContentSource>} sources
   * @returns {Promise}
   */
  async start(sources = null) {
    sources = sources || this.sources;
    if (!sources || sources.length <= 0) {
      this._logger.warn(chalk.yellow(`No sources found to download`));
      return Promise.resolve();
    }
    
    try {
      
      this._logger.info(`Downloading ${chalk.cyan(sources.length)} sources`);
      
      if (this._config.backupAndRestore) {
        this._logger.info(`Backing up ${chalk.cyan(sources.length)} sources`);
        await this.backup(sources);
      }
      
      let sourcesComplete = 0;
      
      for (const source of sources) {
        const progress = (sourcesComplete + 1) + '/' + sources.length;
        this._logger.info(`Downloading source ${chalk.cyan(progress)}: ${chalk.yellow(source)}`);
        let result = await source.fetchContent();

        result = await this._downloadMedia(source, result);
        result = await this._applyContentTransforms(source, result);
        result = await this._saveDataFiles(source, result);

        sourcesComplete++;
      }
      
      this._logger.info(
        chalk.green(`Finished downloading ${sources.length} sources`)
      );
    } catch (err) {
      this._logger.error(chalk.red(`Could not download all content:`), err);
      if (this._config.backupAndRestore) {
        this._logger.info(`Restoring ${chalk.cyan(sources.length)} sources`);
        await this.restore(sources);
      }
    }
    
    try {
      this._logger.debug(`Cleaning up temp and backup files`);
      await this.clear(sources, {
        temp: true,
        backups: true,
        downloads: false,
      });
    } catch (err) {
      this._logger.error(`Could not clean up temp and backup files`, err);
    }
    
    return Promise.resolve();
  }
  
  /**
   * Alias for start(source)
   * @param {Array<ContentSource>} sources
   * @returns {Promise}
   */
  async download(sources = null) {
    return this.start(sources);
  }
  
  /**
   * Clears all cached content except for files that match config.keep.
   * @param {Array<ContentSource>} sources The sources you want to clear. If left undefined, this will clear all known sources. If no sources are passed, the entire downloads/temp/backup dirs are removed.
   * 
   * @param {boolean} temp Clear the temp dir
   * @param {boolean} backups Clear the backup dir
   * @param {boolean} downloads Clear the download dir
   * @param {boolean} removeIfEmpty Remove each dir if it's empty after clearing
   */
  async clear(sources = null, {
    temp = true,
    backups = true,
    downloads = true,
    removeIfEmpty = true,
  } = {}) {
    sources = sources || [null];
    for (const source of sources) {
      const sourceLabel = source ? `source ${source}` : 'all sources';
      if (temp) {
        this._logger.debug(`Clearing temp files of ${chalk.yellow(sourceLabel)}`);
        await this._clearDir(this.getTempPath(source), {removeIfEmpty, ignoreKeep: true});
      }
      if (backups) {
        this._logger.debug(`Clearing backup of ${chalk.yellow(sourceLabel)}`);
        await this._clearDir(this.getBackupPath(source), {removeIfEmpty, ignoreKeep: true});
      }
      if (downloads) {
        this._logger.debug(`Clearing downloads of ${chalk.yellow(sourceLabel)}`);
        await this._clearDir(this.getDownloadPath(source), {removeIfEmpty});
      }
    }
    
    if (removeIfEmpty && temp) {
      await FileUtils.removeDirIfEmpty(this.getTempPath());
    }
    if (removeIfEmpty && backups) {
      await FileUtils.removeDirIfEmpty(this.getBackupPath());
    }
    if (removeIfEmpty && downloads) {
      await FileUtils.removeDirIfEmpty(this.getDownloadPath());
    }
    
    return Promise.resolve();
  }
  
  /**
   * Backs up all downloads of source to a separate backup dir.
   * @param {Array<ContentSource>} source 
   */
  async backup(sources = null) {
    for (const source of sources) {
      try {
        const downloadPath = this.getDownloadPath(source);
        const backupPath = this.getBackupPath(source);
        if (!fs.existsSync(downloadPath)) {
          throw new Error(`No downloads found at ${downloadPath}`);
        }
        this._logger.debug(`Backing up ${source}`);
        await fs.copy(downloadPath, backupPath, {preserveTimestamps: true});
      } catch (err) {
        this._logger.warn(`Couldn't back up ${source}:`, err);
      }
    }
  }
  
  /**
   * Restores all downloads of source from its backup dir if it exists.
   * @param {Array<ContentSource>} source 
   * @param {boolean} removeBackups
   */
  async restore(sources = null, removeBackups = true) {
    for (const source of sources) {
      try {
        const downloadPath = this.getDownloadPath(source);
        const backupPath = this.getBackupPath(source);
        if (!fs.existsSync(backupPath)) {
          throw new Error(`No backups found at ${backupPath}`);
        }
        this._logger.info(`Restoring ${source} from backup`);
        await fs.copy(backupPath, downloadPath, {preserveTimestamps: true});
        if (removeBackups) {
          this._logger.debug(`Removing backup for ${source}`);
          await fs.remove(backupPath);
        }
      } catch (err) {
        this._logger.error(`Couldn't restore ${source}:`, err);
      }
    }
  }
  
  /**
   * @param {ContentSource} source 
   * @returns {string}
   */
  getDownloadPath(source = null) {
    if (source) {
      return path.resolve(path.join(this._config.downloadPath, source.config.id));
    } else {
      return path.resolve(this._config.downloadPath);
    }
  }
  
  /**
   * @param {ContentSource} source 
   * @returns {string}
   */
  getTempPath(source = null) {
    const downloadPath = this._config.downloadPath;
    const tokenizedPath = this._config.tempPath;
    const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
    if (source) {
      return path.join(detokenizedPath, source.config.id);
    } else {
      return detokenizedPath;
    }
  }
  
  /**
   * @param {ContentSource} source 
   * @returns {string}
   */
  getBackupPath(source = null) {
    const downloadPath = this._config.downloadPath;
    const tokenizedPath = this._config.backupPath;
    const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
    if (source) {
      return path.join(detokenizedPath, source.config.id);
    } else {
      return detokenizedPath;
    }
  }
  
  /**
   * 
   * @param {Array<*>|Object} sourceConfigs 
   * @returns {Array<ContentSource>}
   */
  _createSources(sourceConfigs) {
    if (!sourceConfigs || sourceConfigs.length === 0) {
      this._logger.warn(`No content sources found in config.`);
      return;
    }
    
    const sources = [];
    
    if (!Array.isArray(sourceConfigs)) {
      // Backwards compatibility for key/value-based
      // configs where the key is the source ID
      const entries = Object.entries(sourceConfigs);
      const configs = [];
      for (const [id, config] of entries) {
        configs.push({
          id: id,
          ...config
        });
      }
      sourceConfigs = configs;
    }
    
    for (const sourceConfig of sourceConfigs) {
      try {
        /**
         * @type {ContentSource}
         */
        let source;
        const config = {
          ...this._config,
          ...sourceConfig,
        };

        switch (sourceConfig.type) {
          case ContentSourceTypes.airtable:
            source = new AirtableSource(config, this._logger);
            break;
          case ContentSourceTypes.contentful:
            source = new ContentfulSource(config, this._logger);
            break;
          case ContentSourceTypes.strapi:
            source = new StrapiSource(config, this._logger);
            break;
          case ContentSourceTypes.sanity:
            source = new SanitySource(config, this._logger);
            break;
          case ContentSourceTypes.json:
          default:
            if (sourceConfig.type !== ContentSourceTypes.json) {
              if (config && sourceConfig.type) {
                this._logger.warn(`Unknown source type '${sourceConfig.type}'. Defaulting ${config.id} to '${ContentSourceTypes.json}'.`);
              } else {
                this._logger.info(`Defaulting source '${config.id}' to 'json'.`);
              }
            }
            source = new JsonSource(config, this._logger);
            break;
        }

        sources.push(source);
      } catch (err) {
        this._logger.error(`Could not create content source:`, err);
      }
    }
    
    return sources;
  }

  /**
   * Downloads media files from a content result with rollback capabilities.
   *
   * @param {ContentSource} source
   * @param {ContentResult} result
   * @returns {ContentResult}
   */
  async _downloadMedia(source, result) {
    await this._mediaDownloader.sync(result.mediaDownloads, new ContentOptions({
      ...this._config,
      ...source.config,
      ...{
        downloadPath: this.getDownloadPath(source),
        tempPath: this.getTempPath(source),
      },
    }));

    return result;
  }

  /**
   * Saves a result's data file to a local path
   * @param {ContentSource} source
   * @param {ContentResult} result
   * @returns {ContentResult}
   */
  async _saveDataFiles(source, result) {
    for (const resultData of result.dataFiles) {
      try {
        const filePath = path.join(
          this._config.downloadPath,
          source.config.id,
          resultData.localPath
        );
        await FileUtils.saveJson(resultData.content, filePath);
      } catch (error) {
        this._logger.error(`Could not save json ${resultData.localPath}`);
        this._logger.error(error);
      }
    }
    return Promise.resolve(result);
  }

  /**
   * Saves a result's data file to a local path
   * @param {ContentSource} source
   * @param {ContentResult} result
   * @returns {ContentResult}
   */
  async _applyContentTransforms(source, result) {
    const transforms = source.config.contentTransforms || this.config.contentTransforms;

    for (const resultData of result.dataFiles) {
      if (!resultData.content) {
        continue;
      }

      for (const [path, transformIds] of Object.entries(transforms)) {
        for (const transformId of transformIds) {
          if (!this._contentTransforms.has(transformId)) {
            this._logger.error(`Unsupported content transform: '${transformId}'`);
            continue;
          }
          
          const transformIdStr = chalk.yellow(transformId);
          const pathStr = chalk.yellow(path);
          const localPathStr = chalk.yellow(resultData.localPath);
          
          try {
            this._logger.debug(
              chalk.gray(`Applying content transform ${transformIdStr} to '${pathStr}' in ${localPathStr}`)
            );
            jsonpath.apply(
              resultData.content,
              path,
              this._contentTransforms.get(transformId).transform
            );
          } catch (error) {
            this._logger.error(
              chalk.red(`Could not apply content transform ${transformIdStr} to '${pathStr}' in ${localPathStr}`)
            );
            this._logger.error(error);
          }
        }
      }
    }

    return Promise.resolve(result);
  }
  
  async _clearDir(dirPath, {
    removeIfEmpty = true,
    ignoreKeep = false,
  } = {}) {
    try {
      if (!fs.existsSync(dirPath)) {
        return;
      }
      FileUtils.removeFilesFromDir(dirPath, ignoreKeep ? undefined : this._config.keep);
      if (removeIfEmpty) {
        await FileUtils.removeDirIfEmpty(dirPath);
      }
    } catch (err) {
      this._logger.error(chalk.red(`Could not clear ${chalk.yellow(dirPath)} (make sure dir is not in use):`), err);
    }
  }

  _getDetokenizedPath(tokenizedPath, downloadPath) {
    if (tokenizedPath.includes(Constants.TIMESTAMP_TOKEN)) {
      tokenizedPath = tokenizedPath.replace(Constants.TIMESTAMP_TOKEN, FileUtils.getDateString());
    }
    if (tokenizedPath.includes(Constants.DOWNLOAD_PATH_TOKEN)) {
      tokenizedPath = tokenizedPath.replace(Constants.DOWNLOAD_PATH_TOKEN, downloadPath);
    }
    return path.resolve(tokenizedPath);
  }
}

export default LaunchpadContent;
