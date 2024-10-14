import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';

import Credentials from './credentials.js';
import { CONTENT_OPTION_DEFAULTS, DOWNLOAD_PATH_TOKEN, TIMESTAMP_TOKEN, resolveContentOptions } from './content-options.js';

import ContentSource from './content-sources/content-source.js';
import AirtableSource from './content-sources/airtable-source.js';
import JsonSource from './content-sources/json-source.js';
import ContentfulSource from './content-sources/contentful-source.js';
import StrapiSource from './content-sources/strapi-source.js';
import SanitySource from './content-sources/sanity-source.js';

import MediaDownloader from './utils/media-downloader.js';
import FileUtils from './utils/file-utils.js';

import { LogManager, Logger, onExit } from '@bluecadet/launchpad-utils';
import ContentResult from './content-sources/content-result.js';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { createPluginsFromConfig } from './content-plugin.js';

/**
 * @enum {import('./content-options.js').AllSourceOptions['type']}
 */
export const ContentSourceTypes = {
	/** @type {'json'} */
	json: 'json',
	/** @type {'airtable'} */
	airtable: 'airtable',
	/** @type {'contentful'} */
	contentful: 'contentful',
	/** @type {'sanity'} */
	sanity: 'sanity',
	/** @type {'strapi'} */
	strapi: 'strapi'
};

export class LaunchpadContent {
	/**
	 * Creates a new LaunchpadContent and downloads content using an optional user config object.
	 * @param {import('./content-options.js').ContentOptions} [config]
	 * @returns {Promise.<LaunchpadContent>} Promise that resolves with the new LaunchpadContent instance.
	 */
	static async createAndDownload(config) {
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

	/** @type {import('./content-options.js').ResolvedContentOptions} */
	_config;

	/** @type {Logger} */
	_logger;

	/** @type {PluginDriver<import('./content-plugin.js').ContentHooks>} */
	_pluginDriver;

	/** @type {Array<ContentSource>} */
	_sources = [];

	/** @type {MediaDownloader} */
	_mediaDownloader;

	/** @type {Date} */
	_startDatetime = new Date();

	/**
	 * @param {import('./content-options.js').ContentOptions} [config]
	 * @param {Logger} [parentLogger]
	 * @param {PluginDriver<import('./content-plugin.js').ContentHooks>} [pluginDriver]
	 */
	constructor(config, parentLogger, pluginDriver) {
		this._config = resolveContentOptions(config);
		this._logger = LogManager.getInstance().getLogger('content', parentLogger);
		this._mediaDownloader = new MediaDownloader(this._logger);
		this._pluginDriver = pluginDriver || new PluginDriver([]);

		// TODO: remove once json configs are fully supported
		const configPlugins = createPluginsFromConfig(this._config);
		this._pluginDriver.add(configPlugins);

		if (this._config.credentialsPath) {
			try {
				Credentials.init(this._config.credentialsPath, this._logger);
			} catch (err) {
				if (err instanceof Error) {
					this._logger.warn('Could not load credentials:', err.message);
				}
			}
		}

		this.sources = this._createSources(this._config.sources);

		onExit(async () => {
			this._mediaDownloader.abort();
		});
	}

	/**
	 * @param {Array<ContentSource>?} sources
	 * @returns {Promise<void>}
	 */
	async start(sources = null) {
		sources = sources || this.sources;
		if (!sources || sources.length <= 0) {
			this._logger.warn(chalk.yellow('No sources found to download'));
			return Promise.resolve();
		}

		this._startDatetime = new Date();

		await this._pluginDriver.runHookSequential('onContentFetchSetup');

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

				await this._pluginDriver.runHookSequential('onContentFetchData', {
					dataFiles: result.dataFiles
				});

				result = await this._downloadMedia(source, result);
				result = await this._saveDataFiles(source, result);

				sourcesComplete++;
			}

			this._logger.info(
				chalk.green(`Finished downloading ${sources.length} sources`)
			);
		} catch (err) {
			this._logger.error(chalk.red('Could not download all content:'), err);
			await this._pluginDriver.runHookSequential('onContentFetchError');
			if (this._config.backupAndRestore) {
				this._logger.info(`Restoring ${chalk.cyan(sources.length)} sources`);
				await this.restore(sources);
			}
		}

		try {
			this._logger.debug('Cleaning up temp and backup files');
			await this.clear(sources, {
				temp: true,
				backups: true,
				downloads: false
			});
		} catch (err) {
			this._logger.error('Could not clean up temp and backup files', err);
		}

		return Promise.resolve();
	}

	/**
	 * Alias for start(source)
	 * @param {Array<ContentSource>} sources
	 * @returns {Promise<void>}
	 */
	async download(sources = []) {
		return this.start(sources);
	}

	/**
	 * Clears all cached content except for files that match config.keep.
	 * @param {Array<ContentSource>} sources The sources you want to clear. If left undefined, this will clear all known sources. If no sources are passed, the entire downloads/temp/backup dirs are removed.
	 * 
	 * @param {object} options
	 * @param {boolean} [options.temp] Clear the temp dir
	 * @param {boolean} [options.backups] Clear the backup dir
	 * @param {boolean} [options.downloads] Clear the download dir
	 * @param {boolean} [options.removeIfEmpty] Remove each dir if it's empty after clearing
	 */
	async clear(sources = [], {
		temp = true,
		backups = true,
		downloads = true,
		removeIfEmpty = true
	} = {}) {
		sources = sources || [null];
		for (const source of sources) {
			const sourceLabel = source ? `source ${source}` : 'all sources';
			if (temp) {
				this._logger.debug(`Clearing temp files of ${chalk.yellow(sourceLabel)}`);
				await this._clearDir(this.getTempPath(source), { removeIfEmpty, ignoreKeep: true });
			}
			if (backups) {
				this._logger.debug(`Clearing backup of ${chalk.yellow(sourceLabel)}`);
				await this._clearDir(this.getBackupPath(source), { removeIfEmpty, ignoreKeep: true });
			}
			if (downloads) {
				this._logger.debug(`Clearing downloads of ${chalk.yellow(sourceLabel)}`);
				await this._clearDir(this.getDownloadPath(source), { removeIfEmpty });
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
	 * @param {Array<ContentSource>} sources
	 */
	async backup(sources = []) {
		for (const source of sources) {
			try {
				const downloadPath = this.getDownloadPath(source);
				const backupPath = this.getBackupPath(source);
				if (!fs.existsSync(downloadPath)) {
					throw new Error(`No downloads found at ${downloadPath}`);
				}
				this._logger.debug(`Backing up ${source}`);
				await fs.copy(downloadPath, backupPath, { preserveTimestamps: true });
			} catch (err) {
				this._logger.warn(`Couldn't back up ${source}:`, err);
			}
		}
	}

	/**
	 * Restores all downloads of source from its backup dir if it exists.
	 * @param {Array<ContentSource>} sources 
	 * @param {boolean} removeBackups
	 */
	async restore(sources = [], removeBackups = true) {
		for (const source of sources) {
			try {
				const downloadPath = this.getDownloadPath(source);
				const backupPath = this.getBackupPath(source);
				if (!fs.existsSync(backupPath)) {
					throw new Error(`No backups found at ${backupPath}`);
				}
				this._logger.info(`Restoring ${source} from backup`);
				await fs.copy(backupPath, downloadPath, { preserveTimestamps: true });
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
	 * @param {ContentSource} [source] 
	 * @returns {string}
	 */
	getDownloadPath(source) {
		if (source) {
			return path.resolve(path.join(this._config.downloadPath, source.config.id));
		} else {
			return path.resolve(this._config.downloadPath);
		}
	}

	/**
	 * @param {ContentSource} [source] 
	 * @returns {string}
	 */
	getTempPath(source) {
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
	 * @param {ContentSource} [source] 
	 * @returns {string}
	 */
	getBackupPath(source) {
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
	 * @param {import('./content-options.js').ContentOptions['sources']} sourceConfigs 
	 * @returns {Array<ContentSource>}
	 */
	_createSources(sourceConfigs) {
		if (!sourceConfigs || (Array.isArray(sourceConfigs) && sourceConfigs.length === 0)) {
			this._logger.warn('No content sources found in config.');
			return [];
		}

		const sources = [];

		/**
		 * @type {(import('./content-options.js').AllSourceOptions)[]}
		 */
		let sourceConfigArray = [];

		if (!Array.isArray(sourceConfigs)) {
			// Backwards compatibility for key/value-based
			// configs where the key is the source ID
			const entries = Object.entries(sourceConfigs);
			for (const [id, config] of entries) {
				sourceConfigArray.push({
					...config,
					id
				});
			}
		} else {
			sourceConfigArray = sourceConfigs;
		}

		for (const sourceConfig of sourceConfigArray) {
			try {
				/**
				 * @type {ContentSource}
				 */
				let source;

				switch (sourceConfig.type) {
					case ContentSourceTypes.airtable:
						source = new AirtableSource(sourceConfig, this._logger);
						break;
					case ContentSourceTypes.contentful:
						source = new ContentfulSource(sourceConfig, this._logger);
						break;
					case ContentSourceTypes.strapi:
						source = new StrapiSource(sourceConfig, this._logger);
						break;
					case ContentSourceTypes.sanity:
						source = new SanitySource(sourceConfig, this._logger);
						break;
					case ContentSourceTypes.json:
					default:
						if (sourceConfig.type !== ContentSourceTypes.json) {
							// @ts-expect-error - user may have passed in a custom type that we don't know about
							if ((sourceConfig).type) {
								// @ts-expect-error
								this._logger.warn(`Unknown source type '${sourceConfig.type}'. Defaulting ${sourceConfig.id} to '${ContentSourceTypes.json}'.`);
							} else {
								// @ts-expect-error
								this._logger.info(`Defaulting source '${sourceConfig.id}' to 'json'.`);
							}
						}
						source = new JsonSource(sourceConfig, this._logger);
						break;
				}

				sources.push(source);
			} catch (err) {
				this._logger.error('Could not create content source:', err);
			}
		}

		return sources;
	}

	/**
	 * Downloads media files from a content result with rollback capabilities.
	 *
	 * @param {ContentSource} source
	 * @param {ContentResult} result
	 * @returns {Promise<ContentResult>}
	 */
	async _downloadMedia(source, result) {
		await this._mediaDownloader.sync(result.mediaDownloads, {
			...this._config,
			downloadPath: this.getDownloadPath(source),
			tempPath: this.getTempPath(source)
		});

		return result;
	}

	/**
	 * Saves a result's data file to a local path
	 * @param {ContentSource} source
	 * @param {ContentResult} result
	 * @returns {Promise<ContentResult>}
	 */
	async _saveDataFiles(source, result) {
		for (const resultData of result.dataFiles) {
			try {
				const encodeRegex = new RegExp(`[${this._config.encodeChars}]`, 'g');
				const filePath = path.join(
					this._config.downloadPath,
					source.config.id,
					resultData.localPath
				).replace(encodeRegex, encodeURIComponent);
				await FileUtils.saveJson(resultData.content, filePath);
			} catch (error) {
				this._logger.error(`Could not save json ${resultData.localPath}`);
				this._logger.error(error);
			}
		}
		return Promise.resolve(result);
	}
	/**
	 * @param {string} dirPath
	 */
	async _clearDir(dirPath, {
		removeIfEmpty = true,
		ignoreKeep = false
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

	/**
	 * @param {string} tokenizedPath
	 * @param {string} downloadPath
	 */
	_getDetokenizedPath(tokenizedPath, downloadPath) {
		if (tokenizedPath.includes(TIMESTAMP_TOKEN)) {
			tokenizedPath = tokenizedPath.replace(TIMESTAMP_TOKEN, FileUtils.getDateString(this._startDatetime));
		}
		if (tokenizedPath.includes(DOWNLOAD_PATH_TOKEN)) {
			tokenizedPath = tokenizedPath.replace(DOWNLOAD_PATH_TOKEN, downloadPath);
		}
		return path.resolve(tokenizedPath);
	}
}

export default LaunchpadContent;
