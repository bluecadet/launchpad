import path from "node:path";
import { LogManager, type Logger } from "@bluecadet/launchpad-utils";
import { PluginDriver } from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import { ResultAsync, err, ok, okAsync } from "neverthrow";
import {
	type ConfigContentSource,
	type ContentConfig,
	DOWNLOAD_PATH_TOKEN,
	type ResolvedContentConfig,
	TIMESTAMP_TOKEN,
	contentConfigSchema,
} from "./content-config.js";
import { ContentError, ContentPluginDriver } from "./content-plugin-driver.js";
import type { ContentSource } from "./sources/source.js";
import { DataStore } from "./utils/data-store.js";
import * as FileUtils from "./utils/file-utils.js";

class LaunchpadContent {
	_config: ResolvedContentConfig;
	_logger: Logger;
	_pluginDriver: ContentPluginDriver;
	_rawSources: ConfigContentSource[];
	_startDatetime = new Date();
	_dataStore: DataStore;

	constructor(config: ContentConfig, parentLogger: Logger) {
		this._config = contentConfigSchema.parse(config);

		this._logger = LogManager.getLogger("content", parentLogger);

		this._dataStore = new DataStore(this._config.downloadPath);

		// create all sources
		this._rawSources = this._config.sources;

		const basePluginDriver = new PluginDriver(this._logger, this._config.plugins);

		this._pluginDriver = new ContentPluginDriver(basePluginDriver, {
			dataStore: this._dataStore,
			options: this._config,
			paths: {
				getDownloadPath: this.getDownloadPath.bind(this),
				getTempPath: this.getTempPath.bind(this),
				getBackupPath: this.getBackupPath.bind(this),
			},
		});
	}

	start(rawSources: ConfigContentSource[] | null = null): ResultAsync<void, ContentError> {
		const inputSources = rawSources || this._rawSources;
		if (!inputSources || inputSources.length <= 0) {
			this._logger.warn(chalk.yellow("No sources found to download"));
			return okAsync(undefined);
		}

		this._startDatetime = new Date();

		return this._createSourcesFromConfig(inputSources)
			.andThrough(() => this._pluginDriver.runHookSequential("onContentFetchSetup"))
			.andThen((sources) =>
				this.backup(sources)
					.andTee(() => this._logger.info("Clearing download directory"))
					.andThen(() =>
						this.clear(sources, {
							temp: false,
							backups: false,
							downloads: true,
						})
					)
					.andThen(() => this._fetchSources(sources))
					.andThrough(() => this._pluginDriver.runHookSequential("onContentFetchDone"))
					.andThen(() =>
						ResultAsync.fromPromise(
							this._dataStore.close(),
							(e) => new ContentError("Failed to close data store", { cause: e }),
						),
					)
					.orElse((e) => {
						this._pluginDriver.runHookSequential("onContentFetchError", e);
						this._logger.error("Error in content fetch process:", e);
						this._logger.info("Restoring from backup...");
						return this.restore(sources).andThen(() => {
							return err(
								new ContentError("Failed to download content. Restored from backup.", { cause: e }),
							);
						});
					})
					.andTee(() => this._logger.info("Content fetch complete. Clearing temp and backup directories."))
					.andThen(() =>
						this.clear(sources, {
							temp: true,
							backups: true,
							downloads: false,
						}),
					),
			);
	}

	/**
	 * Alias for start(source)
	 */
	download(rawSources: ConfigContentSource[] | null = null): ResultAsync<void, ContentError> {
		return this.start(rawSources);
	}

	/**
	 * Clears all cached content except for files that match config.keep.
	 * @param sources The sources you want to clear. If left undefined, this will clear all known sources. If no sources are passed, the entire downloads/temp/backup dirs are removed.
	 */
	clear(
		sources: ContentSource[] = [],
		{ temp = true, backups = true, downloads = true, removeIfEmpty = true } = {},
	): ResultAsync<void, ContentError> {
		return ResultAsync.combine(
			sources.map((source) => {
				const tasks = [] as ResultAsync<void, ContentError>[];
				if (temp) {
					tasks.push(
						this._clearDir(this.getTempPath(source.id), { removeIfEmpty, ignoreKeep: true }),
					);
				}
				if (backups) {
					tasks.push(
						this._clearDir(this.getBackupPath(source.id), { removeIfEmpty, ignoreKeep: true }),
					);
				}
				if (downloads) {
					tasks.push(this._clearDir(this.getDownloadPath(source.id), { removeIfEmpty }));
				}
				return ResultAsync.combine(tasks);
			}),
		)
			.andThen(() => {
				const tasks: ResultAsync<void, FileUtils.FileUtilsError>[] = [];
				if (removeIfEmpty) {
					if (temp) tasks.push(FileUtils.removeDirIfEmpty(this.getTempPath()));
					if (backups) tasks.push(FileUtils.removeDirIfEmpty(this.getBackupPath()));
					if (downloads) tasks.push(FileUtils.removeDirIfEmpty(this.getDownloadPath()));
				}
				return ResultAsync.combine(tasks);
			})
			.map(() => undefined) // return void instead of void[]
			.mapErr((error) => new ContentError("Failed to clear directories", { cause: error }));
	}

	/**
	 * Backs up all downloads of source to a separate backup dir.
	 */
	backup(sources: ContentSource[] = []): ResultAsync<void, ContentError> {
		this._logger.info("Backing up downloads...");
		return ResultAsync.combine(
			sources.map((source) => {
				const downloadPath = this.getDownloadPath(source.id);
				const backupPath = this.getBackupPath(source.id);

				return FileUtils.pathExists(downloadPath).andThen((exists) => {
					if (!exists) {
						this._logger.warn(
							`Skipping backup for ${source.id}: No downloads found at ${downloadPath}`,
						);
						return ok(undefined);
					}
					this._logger.info(`Backing up source: ${source.id}`);
					return FileUtils.copy(downloadPath, backupPath);
				});
			}),
		)
			.mapErr((e) => new ContentError("Failed to backup sources", { cause: e }))
			.map(() => undefined); // return void instead of void[]
	}

	/**
	 * Restores all downloads of source from its backup dir if it exists.
	 */
	restore(sources: ContentSource[] = [], removeBackups = true): ResultAsync<void, ContentError> {
		this._logger.info("Attempting to restore from backup...");
		
		return ResultAsync.combine(
			sources.map((source) => {
				const downloadPath = this.getDownloadPath(source.id);
				const backupPath = this.getBackupPath(source.id);

				return FileUtils.pathExists(backupPath)
					.andThen(exists => {
						if (!exists) {
							this._logger.warn(`No backup found for ${source.id}`);
							return ok(undefined);
						}

						this._logger.info(`Restoring ${chalk.white(source.id)} from backup`);

						return FileUtils.copy(backupPath, downloadPath, { preserveTimestamps: true }).andThen(() => {
							if (removeBackups) {
								this._logger.debug(`Removing backup for ${chalk.white(source.id)}`);
								return FileUtils.remove(backupPath);
							}
							return ok(undefined);
						});
					})
					.mapErr(
						(e) => new ContentError(`Failed to restore source ${chalk.white(source.id)}`, { cause: e }),
					);
			}),
		).map(() => undefined); // return void instead of void[]
	}

	getDownloadPath(sourceId?: string): string {
		if (sourceId) {
			return path.resolve(path.join(this._config.downloadPath, sourceId));
		}
		return path.resolve(this._config.downloadPath);
	}

	getTempPath(sourceId?: string, pluginName?: string): string {
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

	getBackupPath(sourceId?: string): string {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.backupPath;
		const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
		if (sourceId) {
			return path.join(detokenizedPath, sourceId);
		}
		return detokenizedPath;
	}

	_createSourcesFromConfig(
		rawSources: ConfigContentSource[],
	): ResultAsync<ContentSource[], ContentError> {
		return ResultAsync.combine(
			rawSources.map((source) =>
				ResultAsync.fromPromise(
					// wrap source in promise to ensure it's awaited
					Promise.resolve(source),
					(error) => new ContentError("Failed to build source", { cause: error }),
				),
			),
		).orElse((e) => {
			this._pluginDriver.runHookSequential("onSetupError", e);
			return err(e);
		});
	}

	_fetchSources(sources: ContentSource[]): ResultAsync<void, ContentError> {
		this._logger.info("Beginning content fetch process");
		this._logger.info(`Fetching ${sources.length} source(s): ${sources.map((source) => source.id).join(", ")}`);
		// Fetch sources in parallel
		return ResultAsync.combine(
			sources.map((source) => {
				const sourceLogger = LogManager.getLogger(`source:${source.id}`, this._logger);

				const initializedFetch = source.fetch({
					logger: sourceLogger,
					dataStore: this._dataStore,
				});

				const fetchAsArray = Array.isArray(initializedFetch)
					? initializedFetch
					: [initializedFetch];

				return this._dataStore
					.createNamespace(source.id)
					.andThen((namespace) => {
						return ResultAsync.combine(
							fetchAsArray.map((fetch) => namespace.safeInsert(fetch.id, fetch.data)),
						);
					})
					.mapErr((e) => new ContentError(`Failed to fetch source ${source.id}`, { cause: e }));
			}),
		).map(() => undefined); // return void instead of void[]
	}

	_clearDir(
		dirPath: string,
		{ removeIfEmpty = true, ignoreKeep = false } = {},
	): ResultAsync<void, ContentError> {
		return FileUtils.pathExists(dirPath)
			.andThen((exists) => {
				if (!exists) return okAsync(undefined);
				return FileUtils.removeFilesFromDir(
					dirPath,
					ignoreKeep ? undefined : this._config.keep,
				).andThen(() => {
					if (removeIfEmpty) {
						return FileUtils.removeDirIfEmpty(dirPath);
					}

					return okAsync(undefined);
				});
			})
			.mapErr((e) => new ContentError(`Failed to clear directory: ${dirPath}`, { cause: e }));
	}

	_getDetokenizedPath(tokenizedPath: string, downloadPath: string): string {
		let innerTokenizedPath = tokenizedPath;
		if (innerTokenizedPath.includes(TIMESTAMP_TOKEN)) {
			innerTokenizedPath = innerTokenizedPath.replace(
				TIMESTAMP_TOKEN,
				FileUtils.getDateString(this._startDatetime),
			);
		}
		if (innerTokenizedPath.includes(DOWNLOAD_PATH_TOKEN)) {
			innerTokenizedPath = innerTokenizedPath.replace(DOWNLOAD_PATH_TOKEN, downloadPath);
		}
		return path.resolve(innerTokenizedPath);
	}
}

export default LaunchpadContent;
