import path from 'path';
import chalk from 'chalk';

import { DOWNLOAD_PATH_TOKEN, TIMESTAMP_TOKEN, resolveContentOptions } from './content-options.js';

import * as FileUtils from './utils/file-utils.js';
import { LogManager } from '@bluecadet/launchpad-utils';
import PluginDriver from '@bluecadet/launchpad-utils/lib/plugin-driver.js';
import { ContentError, ContentPluginDriver } from './content-plugin-driver.js';
import { DataStore } from './utils/data-store.js';
import { ok, err, ResultAsync, okAsync, errAsync } from 'neverthrow';

export class LaunchpadContent {
	/** @type {import('./content-options.js').ResolvedContentOptions} */
	_config;

	/** @type {import('@bluecadet/launchpad-utils').Logger} */
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
	 * @param {import('./content-options.js').ContentOptions} config
	 * @param {import('@bluecadet/launchpad-utils').Logger} parentLogger
	 */
	constructor(config, parentLogger) {
		this._config = resolveContentOptions(config);

		this._logger = LogManager.getLogger('content', parentLogger);

		this._dataStore = new DataStore();

		// create all sources
		this._rawSources = this._config.sources;

		const basePluginDriver = new PluginDriver(this._logger, this._config.plugins);

		this._pluginDriver = new ContentPluginDriver(
			basePluginDriver,
			{
				dataStore: this._dataStore,
				options: this._config,
				paths: {
					getDownloadPath: this.getDownloadPath.bind(this),
					getTempPath: this.getTempPath.bind(this),
					getBackupPath: this.getBackupPath.bind(this)
				}
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
			.andThrough(() => this._pluginDriver.runHookSequential('onContentFetchSetup'))
			.andThen(
				sources => this.backup(sources)
					.andThen(() => this.clear(sources, {
						temp: false,
						backups: false,
						downloads: true
					}))
					.andThen(() => this._fetchSources(sources))
					.andThrough(() => this._pluginDriver.runHookSequential('onContentFetchDone'))
					.andThen(() => this._writeDataStoreToDisk(this._dataStore))
					.orElse(e => {
						this._pluginDriver.runHookSequential('onContentFetchError', e);
						this._logger.error('Error in content fetch process:', e);
						this._logger.info('Restoring from backup...');
						return this.restore(sources).andThen(() => {
							console.log('HERE');
							return err(new ContentError('Failed to download content. Restored from backup.', { cause: e }));
						});
					})
					.andThen(() => this.clear(sources, {
						temp: true,
						backups: true,
						downloads: false
					}))
			);
	}

	/**
	 * Alias for start(source)
	 * @param {import('./content-options.js').ConfigContentSource[]?} rawSources
	 */
	download(rawSources = null) {
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
				tasks.push(this._clearDir(this.getTempPath(source.id), { removeIfEmpty, ignoreKeep: true }));
			}
			if (backups) {
				tasks.push(this._clearDir(this.getBackupPath(source.id), { removeIfEmpty, ignoreKeep: true }));
			}
			if (downloads) {
				tasks.push(this._clearDir(this.getDownloadPath(source.id), { removeIfEmpty }));
			}
			return ResultAsync.combine(tasks);
		})).andThen(() => {
			/** @type {ResultAsync<void, FileUtils.FileUtilsError>[]} */
			const tasks = [];
			if (removeIfEmpty) {
				if (temp) tasks.push(FileUtils.removeDirIfEmpty(this.getTempPath()));
				if (backups) tasks.push(FileUtils.removeDirIfEmpty(this.getBackupPath()));
				if (downloads) tasks.push(FileUtils.removeDirIfEmpty(this.getDownloadPath()));
			}
			return ResultAsync.combine(tasks);
		})
			.map(() => undefined) // return void instead of void[]
			.mapErr(error => new ContentError('Failed to clear directories', { cause: error }));
	}

	/**
	 * Backs up all downloads of source to a separate backup dir.
	 * @param {Array<import('./sources/source.js').ContentSource>} sources
	 * @returns {ResultAsync<void, ContentError>}
	 */
	backup(sources = []) {
		return ResultAsync.combine(sources.map(source => {
			const downloadPath = this.getDownloadPath(source.id);
			const backupPath = this.getBackupPath(source.id);

			return FileUtils.pathExists(downloadPath)
				.andThen((exists) => {
					if (!exists) {
						this._logger.warn(`Skipping backup for ${source.id}: No downloads found at ${downloadPath}`);
						return ok(undefined);
					}
					this._logger.debug(`Backing up ${source}`);
					return FileUtils.copy(downloadPath, backupPath);
				});
		}))
			.mapErr(e => new ContentError('Failed to backup sources', { cause: e }))
			.map(() => undefined); // return void instead of void[]
	}

	/**
	 * Restores all downloads of source from its backup dir if it exists.
	 * @param {Array<import('./sources/source.js').ContentSource>} sources 
	 * @param {boolean} removeBackups
	 * @returns {ResultAsync<void, ContentError>}
	 */
	restore(sources = [], removeBackups = true) {
		return ResultAsync.combine(sources.map(source => {
			const downloadPath = this.getDownloadPath(source.id);
			const backupPath = this.getBackupPath(source.id);

			return FileUtils.pathExists(backupPath).andThrough((exists) => {
				if (!exists) {
					return err(`No backups found at ${backupPath}`);
				}
				return ok(undefined);
			}).andTee(() => {
				this._logger.info(`Restoring ${chalk.white(source.id)} from backup`);
			}).andThen(() => {
				return FileUtils.copy(backupPath, downloadPath, { preserveTimestamps: true });
			}).andThen(() => {
				if (removeBackups) {
					this._logger.debug(`Removing backup for ${chalk.white(source.id)}`);
					return FileUtils.remove(backupPath);
				}

				return okAsync(undefined);
			}).mapErr(e => new ContentError(`Failed to restore source ${chalk.white(source.id)}: ${e}`));
		})).map(() => undefined); // return void instead of void[]
	}

	/**
	 * @param {string} [sourceId]
	 * @returns {string}
	 */
	getDownloadPath(sourceId) {
		if (sourceId) {
			return path.resolve(path.join(this._config.downloadPath, sourceId));
		} else {
			return path.resolve(this._config.downloadPath);
		}
	}

	/**
	 * @param {string} [sourceId]
	 * @param {string} [pluginName]
	 * @returns {string}
	 */
	getTempPath(sourceId, pluginName) {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.tempPath;
		let detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);

		if (pluginName) {
			detokenizedPath = path.join(detokenizedPath, pluginName);
		}
		
		if (sourceId) {
			detokenizedPath = path.join(detokenizedPath, sourceId);
		}

		return detokenizedPath;
	}

	/**
	 * @param {string} [sourceId]
	 * @returns {string}
	 */
	getBackupPath(sourceId) {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.backupPath;
		const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
		if (sourceId) {
			return path.join(detokenizedPath, sourceId);
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
				error => new ContentError('Failed to build source', { cause: error })
			).andThen(awaited => {
				if ('value' in awaited || 'error' in awaited) {
					return awaited.mapErr(e => new ContentError('Failed to build source', { cause: e }));
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
				const sourceLogger = LogManager.getLogger(`source:${source.id}`, this._logger);

				return source.fetch({
					logger: sourceLogger,
					dataStore: this._dataStore
				})
					.asyncAndThen(calls => {
						return ResultAsync.combine(calls.map(call => call.dataPromise));
					})
					.mapErr(e => new ContentError(`Failed to fetch source ${source.id}`, { cause: e }))
					.andThrough(fetchResults => {
						/** @type {Map<string, unknown>} */
						const map = new Map();

						for (const result of fetchResults.flat()) {
							map.set(result.id, result.data);
						}

						return this._dataStore.createNamespaceFromMap(source.id, map).mapErr(e => new ContentError(`Unable to create namespace for source ${source.id}`, { cause: e }));
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
			.mapErr(e => new ContentError('Failed to write data store to disk', { cause: e }))
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
		return FileUtils.pathExists(dirPath)
			.andThen(exists => {
				if (!exists) return okAsync(undefined);
				return FileUtils.removeFilesFromDir(dirPath, ignoreKeep ? undefined : this._config.keep)
					.andThen(() => {
						if (removeIfEmpty) {
							return FileUtils.removeDirIfEmpty(dirPath);
						}
	
						return okAsync(undefined);
					});
			}).mapErr(e => new ContentError(`Failed to clear directory: ${dirPath}`, { cause: e }));
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
