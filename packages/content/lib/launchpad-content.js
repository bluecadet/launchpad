import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';

import { DOWNLOAD_PATH_TOKEN, TIMESTAMP_TOKEN, resolveContentOptions } from './content-options.js';

import FileUtils from './utils/file-utils.js';

import { LogManager, Logger } from '@bluecadet/launchpad-utils';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { ContentError, ContentPluginDriver } from './content-plugin-driver.js';
import { DataStore } from './utils/data-store.js';
import { ok, err, ResultAsync, okAsync } from 'neverthrow';

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
	 * @returns {ResultAsync<void, ContentError>}
	 */
	start(rawSources = null) {
		rawSources = rawSources || this._rawSources;
		if (!rawSources || rawSources.length <= 0) {
			this._logger.warn(chalk.yellow('No sources found to download'));
			return okAsync(undefined);
		}

		this._startDatetime = new Date();

		return this._createSourcesFromConfig(rawSources)
			.andTee(() => this._pluginDriver.runHookSequential('onContentFetchSetup'))
			.andThen(sources => this.backup(sources)
				.andThen(() => this._fetchSources(sources))
				.andTee(() => this._pluginDriver.runHookSequential('onContentFetchDone'))
				.andThen(() => this._writeDataStoreToDisk(this._dataStore))
				.andThen(() => this.clear(sources, {
					temp: true,
					backups: true,
					downloads: false
				})).orElse(e => {
					this._pluginDriver.runHookSequential('onContentFetchError', e);
					this._logger.error('Error in content fetch process:', e);
					this._logger.info('Restoring from backup...');
					return this.restore(sources);
				})
			);
	}

	/**
	 * Alias for start(source)
	 * @param {import('./content-options.js').ConfigContentSource[]?} rawSources
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
	 * @returns {ResultAsync<void, ContentError>}
	 */
	clear(sources = [], {
		temp = true,
		backups = true,
		downloads = true,
		removeIfEmpty = true
	} = {}) {
		return ResultAsync.combine(sources.map(source => {
			/** @type {ResultAsync<void, ContentError>[]} */
			const tasks = [];
			if (temp) {
				tasks.push(this._clearDir(this.getTempPath(source), { removeIfEmpty, ignoreKeep: true }));
			}
			if (backups) {
				tasks.push(this._clearDir(this.getBackupPath(source), { removeIfEmpty, ignoreKeep: true }));
			}
			if (downloads) {
				tasks.push(this._clearDir(this.getDownloadPath(source), { removeIfEmpty }));
			}
			return ResultAsync.combine(tasks);
		})).andThen(() => {
			/** @type {ResultAsync<void, string>[]} */
			const tasks = [];
			if (removeIfEmpty) {
				if (temp) tasks.push(FileUtils.removeDirIfEmpty(this.getTempPath()));
				if (backups) tasks.push(FileUtils.removeDirIfEmpty(this.getBackupPath()));
				if (downloads) tasks.push(FileUtils.removeDirIfEmpty(this.getDownloadPath()));
			}
			return ResultAsync.combine(tasks);
		})
			.map(() => undefined) // return void instead of void[]
			.mapErr(error => new ContentError(`Failed to clear directories: ${error instanceof Error ? error.message : String(error)}`));
	}

	/**
	 * Backs up all downloads of source to a separate backup dir.
	 * @param {Array<import('./sources/source.js').ContentSource>} sources
	 * @returns {ResultAsync<void, ContentError>}
	 */
	backup(sources = []) {
		return ResultAsync.combine(sources.map(source => {
			const downloadPath = this.getDownloadPath(source);
			const backupPath = this.getBackupPath(source);
			return ResultAsync.fromPromise(
				fs.pathExists(downloadPath)
					.then(exists => {
						if (!exists) {
							throw new Error(`No downloads found at ${downloadPath}`);
						}
						this._logger.debug(`Backing up ${source}`);
						return fs.copy(downloadPath, backupPath, { preserveTimestamps: true });
					}),
				error => new ContentError(`Failed to backup source ${source.id}: ${error instanceof Error ? error.message : String(error)}`)
			);
		})).map(() => undefined); // return void instead of void[]
	}

	/**
	 * Restores all downloads of source from its backup dir if it exists.
	 * @param {Array<import('./sources/source.js').ContentSource>} sources 
	 * @param {boolean} removeBackups
	 * @returns {ResultAsync<void, ContentError>}
	 */
	restore(sources = [], removeBackups = true) {
		return ResultAsync.combine(sources.map(source => {
			const downloadPath = this.getDownloadPath(source);
			const backupPath = this.getBackupPath(source);
			return ResultAsync.fromPromise(
				fs.pathExists(backupPath)
					.then(exists => {
						if (!exists) {
							throw new Error(`No backups found at ${backupPath}`);
						}
						this._logger.info(`Restoring ${source} from backup`);
						return fs.copy(backupPath, downloadPath, { preserveTimestamps: true })
							.then(() => {
								if (removeBackups) {
									this._logger.debug(`Removing backup for ${source}`);
									return fs.remove(backupPath);
								}
							});
					}),
				error => new ContentError(`Failed to restore source ${source.id}: ${error instanceof Error ? error.message : String(error)}`)
			);
		})).map(() => undefined);
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
	 */
	_createSourcesFromConfig(rawSources) {
		return ResultAsync.combine(rawSources.map(source =>
			ResultAsync.fromPromise(
				// wrap source in promise to ensure it's awaited
				Promise.resolve(source),
				error => new ContentError(error instanceof Error ? error.message : String(error))
			).andThen(awaited => {
				if ('value' in awaited || 'error' in awaited) {
					return awaited.mapErr(e => new ContentError(e instanceof Error ? e.message : String(e)));
				}
				return ok(awaited);
			})
		)).orElse(e => {
			this._pluginDriver.runHookSequential('onSetupError', e);
			return err(e);
		});
	}

	/**
	 * @param {Array<import('./sources/source.js').ContentSource>} sources
	 * @returns {ResultAsync<void, ContentError>}
	 */
	_fetchSources(sources) {
		return ResultAsync.combine(
			sources.map((source) => {
				const sourceLogger = LogManager.getInstance().getLogger(`source:${source.id}`);

				return source.fetch({
					logger: sourceLogger,
					dataStore: this._dataStore
				})
					.asyncAndThen(calls => {
						return ResultAsync.combine(calls.map(call => call.dataPromise));
					})
					.mapErr(e => new ContentError(`Failed to fetch source ${source.id}: ${e instanceof Error ? e.message : String(e)}`))
					.andThrough(fetchResults => {
						/** @type {Map<string, unknown>} */
						const map = new Map();

						for (const result of fetchResults.flat()) {
							map.set(result.id, result.data);
						}

						return this._dataStore.createNamespaceFromMap(source.id, map).mapErr(e => new ContentError(`Unable to create namespace for source ${source.id}: ${e}`));
					});
			}))
			.map(() => undefined); // return void instead of void[]
	}

	/**
	 * @param {import('./utils/data-store.js').DataStore} dataStore
	 * @returns {ResultAsync<void, ContentError>}
	 */
	_writeDataStoreToDisk(dataStore) {
		return ResultAsync.combine(
			Array.from(dataStore.namespaces()).flatMap(namespace =>
				Array.from(namespace.documents()).map(document => {
					const encodeRegex = new RegExp(`[${this._config.encodeChars}]`, 'g');
					const filePath = path.join(
						this._config.downloadPath,
						namespace.id,
						document.id
					).replace(encodeRegex, encodeURIComponent);
					return FileUtils.saveJson(document.data, filePath);
				})
			))
			.mapErr(e => new ContentError(`Failed to write data store to disk: ${e}`))
			.map(() => undefined); // return void instead of void[]
	}

	/**
	 * @param {string} dirPath
	 * @param {object} options
	 * @param {boolean} [options.removeIfEmpty]
	 * @param {boolean} [options.ignoreKeep]
	 * @returns {ResultAsync<void, ContentError>}
	 */
	_clearDir(dirPath, { removeIfEmpty = true, ignoreKeep = false } = {}) {
		return ResultAsync.fromPromise(
			fs.pathExists(dirPath),
			error => new ContentError(`Could not check if dir exists: ${error instanceof Error ? error.message : String(error)}`)
		).andThen(exists => {
			if (!exists) return okAsync(undefined);
			FileUtils.removeFilesFromDir(dirPath, ignoreKeep ? undefined : this._config.keep);
			if (removeIfEmpty) {
				return FileUtils.removeDirIfEmpty(dirPath).mapErr(
					e => new ContentError(e)
				);
			}

			return okAsync(undefined);
		});
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
