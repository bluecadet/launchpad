import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';

import { DOWNLOAD_PATH_TOKEN, TIMESTAMP_TOKEN, resolveContentOptions } from './content-options.js';

import FileUtils from './utils/file-utils.js';

import { LogManager, Logger, onExit } from '@bluecadet/launchpad-utils';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { ContentError, ContentPluginDriver } from './content-plugin-driver.js';
import { DataStore } from './utils/data-store.js';
import { err, ok, Result, ResultAsync } from 'neverthrow';
import { configError } from './sources/source-errors.js';

export class LaunchpadContent {
	/**
	 * Creates a new LaunchpadContent and downloads content using an optional user config object.
	 * @param {import('./content-options.js').ConfigWithContent} config
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

	/** @type {ContentPluginDriver} */
	_pluginDriver;

	/** @type {import('./content-options.js').ConfigContentSource[]} */
	_rawSources;

	/** @type {Date} */
	_startDatetime = new Date();

	/** @type {DataStore} */
	_dataStore;

	/**
	 * @param {import('./content-options.js').ConfigWithContent} [config]
	 * @param {Logger} [parentLogger]
	 * @param {PluginDriver<import('./content-plugin-driver.js').ContentHooks>} [pluginDriver]
	 */
	constructor(config, parentLogger, pluginDriver) {
		this._config = resolveContentOptions(config?.content);
		this._logger = LogManager.getInstance().getLogger('content', parentLogger);
		this._dataStore = new DataStore();

		// create all sources
		this._rawSources = this._config.sources;

		const basePluginDriver = pluginDriver || new PluginDriver(config?.plugins ?? []);

		this._pluginDriver = new ContentPluginDriver(
			basePluginDriver,
			{
				dataStore: new DataStore()
			}
		);
	}

	/**
	 * @param {import('./content-options.js').ConfigContentSource[]?} rawSources
	 * @returns {Promise<import('neverthrow').Result<void, string | undefined>>}
	 */
	async start(rawSources = null) {
		rawSources = rawSources || this._rawSources;
		if (!rawSources || rawSources.length <= 0) {
			this._logger.warn(chalk.yellow('No sources found to download'));
			return ok(undefined);
		}

		const sourcesResult = await this._createSourcesFromConfig(rawSources);
		if (sourcesResult.isErr()) {
			this._logger.error('Error constructing sources. Cancelling content fetch.');
			await this._pluginDriver.runHookSequential('onSetupError', new ContentError(sourcesResult.error.message));
			return err(sourcesResult.error.message);
		}

		const sources = sourcesResult.value;

		this._startDatetime = new Date();

		await this._pluginDriver.runHookSequential('onContentFetchSetup');

		this._logger.info(`Downloading ${chalk.cyan(sources.length)} sources`);

		if (this._config.backupAndRestore) {
			this._logger.info(`Backing up ${chalk.cyan(sources.length)} sources`);

			await this.backup(sources);
		}

		/**
		 * Restore sources and return an error
		 * @param {string} [errorMessage] 
		 * @returns {Promise<import('neverthrow').Err<never, string | undefined>>}
		 */
		const restoreAndErr = async (errorMessage) => {
			if (this._config.backupAndRestore && sources && sources.length > 0) {
				this._logger.info(`Restoring ${chalk.cyan(sources.length)} sources`);
				await this.restore(sources);
			}
			return err(errorMessage);
		};

		let sourcesComplete = 0;
		
		for (const source of sources) {
			const progress = (sourcesComplete + 1) + '/' + sources.length;
			this._logger.info(`Downloading source ${chalk.cyan(progress)}: ${chalk.yellow(source)}`);

			const sourceLogger = LogManager.getInstance().getLogger(`source:${source.id}`);
			
			const result = await source.fetch({
				logger: sourceLogger,
				dataStore: this._dataStore
			});

			if (result.isErr()) {
				this._logger.error(`Error fetching source ${source.id}. Cancelling content fetch.`);
				await this._pluginDriver.runHookSequential('onContentFetchError', new ContentError(result.error.message));
				return restoreAndErr(result.error.message);
			}

			if (!result.value) {
				this._logger.warn(`No data returned for source ${source.id}`);
				continue;
			}

			const dataNamespace = this._dataStore.createNamespaceFromMap(source.id, result.value);

			if (dataNamespace.isErr()) {
				this._logger.error(`Error creating data namespace for source ${source.id}. Cancelling content fetch.`);
				this._logger.error(dataNamespace.error);
				await this._pluginDriver.runHookSequential('onContentFetchError', new ContentError(dataNamespace.error));
				return restoreAndErr(dataNamespace.error);
			}
	
			sourcesComplete++;
		}

		this._logger.info(
			chalk.green(`Finished downloading ${sources.length} sources`)
		);

		await this._pluginDriver.runHookSequential('onContentFetchDone');

		const writeResult = await this._writeDataStoreToDisk(this._dataStore);

		if (writeResult.isErr()) {
			this._logger.error('Error writing data store to disk', writeResult.error);
			return restoreAndErr(writeResult.error);
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

		return ok(undefined);
	}

	/**
	 * Alias for start(source)
	 * @param {import('./content-options.js').ConfigContentSource[]?} rawSources
	 * @returns {Promise<import('neverthrow').Result<void, string | undefined>>}
	 */
	async download(rawSources = null) {
		return this.start(rawSources);
	}

	/**
	 * Clears all cached content except for files that match config.keep.
	 * @param {Array<import('./sources/source.js').ContentSource>} sources The sources you want to clear. If left undefined, this will clear all known sources. If no sources are passed, the entire downloads/temp/backup dirs are removed.
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
	 * @param {Array<import('./sources/source.js').ContentSource>} sources
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
	 * @param {Array<import('./sources/source.js').ContentSource>} sources 
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
	 * @param {import('./sources/source.js').ContentSource} [source] 
	 * @returns {string}
	 */
	getDownloadPath(source) {
		if (source) {
			return path.resolve(path.join(this._config.downloadPath, source.id));
		} else {
			return path.resolve(this._config.downloadPath);
		}
	}

	/**
	 * @param {import('./sources/source.js').ContentSource} [source] 
	 * @returns {string}
	 */
	getTempPath(source) {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.tempPath;
		const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
		if (source) {
			return path.join(detokenizedPath, source.id);
		} else {
			return detokenizedPath;
		}
	}

	/**
	 * @param {import('./sources/source.js').ContentSource} [source] 
	 * @returns {string}
	 */
	getBackupPath(source) {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.backupPath;
		const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
		if (source) {
			return path.join(detokenizedPath, source.id);
		} else {
			return detokenizedPath;
		}
	}

	/**
	 * @param {import('./content-options.js').ConfigContentSource[]} rawSources
	 * @returns {Promise<Result<Array<import('./sources/source.js').ContentSource>, import('./sources/source-errors.js').SourceError>>}
	 */
	async _createSourcesFromConfig(rawSources) {
		const allSourcesAsResults = rawSources.map(async (source) => {
			// need to wrap in try/catch for user sources that don't use the neverthrow api
			try {
				// await any promises
				const awaited = await source;

				if ('value' in awaited || 'error' in awaited) {
					// this is already a result, just return it
					return awaited;
				}

				return ok(awaited);
			} catch (e) {
				this._logger.error('Error creating source', e);

				if (e instanceof Error) {
					return err(configError(e.message));
				} else {
					return err(configError('Unknown error'));
				}
			}
		});

		const createdSources = await Result.combine(await Promise.all(allSourcesAsResults));

		if (createdSources.isErr()) {
			this._logger.error('Error creating sources', createdSources.error);
			return err(createdSources.error);
		}

		return ok(createdSources.value);
	}

	/**
	 * Writes the data store to the configured download path.
	 * @param {import('./utils/data-store.js').DataStore} dataStore
	 * @returns {Promise<Result<void, string>>}
	 */
	async _writeDataStoreToDisk(dataStore) {
		for (const namespace of dataStore.namespaces()) {
			for (const document of namespace.documents()) {
				const encodeRegex = new RegExp(`[${this._config.encodeChars}]`, 'g');
				const filePath = path.join(
					this._config.downloadPath,
					namespace.id,
					document.id
				).replace(encodeRegex, encodeURIComponent);
				const saveResult = await FileUtils.saveJson(document.data, filePath);

				if (saveResult.isErr()) {
					return err(saveResult.error);
				}
			}
		}

		return ok(undefined);
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
