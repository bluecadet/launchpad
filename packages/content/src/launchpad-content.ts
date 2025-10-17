import path from "node:path";
import {
	type CommandExecutor,
	type EventBus,
	type EventBusAware,
	type Logger,
	LogManager,
	onExit,
	PluginDriver,
	type StateProvider,
} from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import { err, ok, okAsync, Result, ResultAsync } from "neverthrow";
import type { ContentCommand } from "./content-commands.js";
import {
	type ConfigContentSource,
	type ContentConfig,
	contentConfigSchema,
	DOWNLOAD_PATH_TOKEN,
	type ResolvedContentConfig,
	TIMESTAMP_TOKEN,
} from "./content-config.js";
import { ContentError, ContentPluginDriver } from "./content-plugin-driver.js";
import type { ContentState } from "./content-state.js";
import type { ContentSource } from "./sources/source.js";
import { DataStore } from "./utils/data-store.js";
import { FetchLogger } from "./utils/fetch-logger.js";
import * as FileUtils from "./utils/file-utils.js";

class LaunchpadContent
	implements EventBusAware, CommandExecutor<ContentCommand>, StateProvider<ContentState>
{
	_config: ResolvedContentConfig;
	_logger: Logger;
	_pluginDriver: ContentPluginDriver;
	_rawSources: ConfigContentSource[];
	_startDatetime = new Date();
	_dataStore: DataStore;
	_abortController = new AbortController();
	_cwd: string;
	_eventBus?: EventBus;
	_state: ContentState;

	constructor(config: ContentConfig, parentLogger: Logger, cwd = process.cwd()) {
		this._config = contentConfigSchema.parse(config);

		this._cwd = cwd;

		this._logger = LogManager.getLogger("content", parentLogger);

		this._dataStore = new DataStore(this._config.downloadPath);

		// create all sources
		this._rawSources = this._config.sources;

		// Initialize state
		this._state = {
			isFetching: false,
			totalSources: this._rawSources.length,
			downloadPath: this._config.downloadPath,
		};

		onExit(() => {
			this._abortController.abort();
		});

		const basePluginDriver = new PluginDriver(
			{ logger: this._logger, cwd: this._cwd },
			this._config.plugins,
		);

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

	/**
	 * Inject EventBus for controller integration.
	 * When EventBus is present, the content system will emit lifecycle events.
	 */
	setEventBus(eventBus: EventBus): void {
		this._eventBus = eventBus;
		this._pluginDriver.setEventBus(eventBus);
	}

	/**
	 * Get the current state of the content system.
	 */
	getState(): ContentState {
		return this._state;
	}

	/**
	 * Execute a command on the content subsystem.
	 * This is called by the controller's CommandDispatcher.
	 */
	executeCommand(command: ContentCommand): ResultAsync<unknown, Error> {
		switch (command.type) {
			case "content.fetch": {
				// TODO: Filter sources if specified in command.sources
				// For now, fetch all sources (filtering requires awaiting promises)
				return this.start(null).mapErr((e) => e as Error);
			}

			case "content.clear": {
				// Convert source IDs to ContentSource objects
				return this._createSourcesFromConfig(this._rawSources)
					.andThen((sources) =>
						this.clear(sources, {
							temp: command.temp ?? true,
							backups: command.backups ?? true,
							downloads: command.downloads ?? true,
						}),
					)
					.mapErr((e) => e as Error);
			}

			case "content.backup": {
				return this._createSourcesFromConfig(this._rawSources)
					.andThen((sources) => this.backup(sources))
					.mapErr((e) => e as Error);
			}

			case "content.restore": {
				return this._createSourcesFromConfig(this._rawSources)
					.andThen((sources) => this.restore(sources, command.removeBackups ?? true))
					.mapErr((e) => e as Error);
			}

			default: {
				// TypeScript exhaustiveness check
				const exhaustiveCheck: never = command;
				return ResultAsync.fromSafePromise(
					Promise.reject(
						new Error(`Unknown content command type: ${(exhaustiveCheck as ContentCommand).type}`),
					),
				);
			}
		}
	}

	start(rawSources: ConfigContentSource[] | null = null): ResultAsync<void, ContentError> {
		const inputSources = rawSources || this._rawSources;
		if (!inputSources || inputSources.length <= 0) {
			this._logger.warn(chalk.yellow("No sources found to download"));
			return okAsync(undefined);
		}

		this._startDatetime = new Date();

		// Update state and emit event (sources are resolved later, so we can't include IDs yet)
		this._state.isFetching = true;
		this._state.lastFetchStart = this._startDatetime;
		this._eventBus?.emit("content:fetch:start", {
			timestamp: this._startDatetime,
		});

		return this._createSourcesFromConfig(inputSources)
			.andThrough(() => this._pluginDriver.runHookSequential("onContentFetchSetup"))
			.andThen((sources) => {
				const backupAndRestore = this._config.backupAndRestore;
				const backupProcess = backupAndRestore ? this.backup(sources) : okAsync(undefined);

				return backupProcess
					.andTee(() => this._logger.info("Clearing download directory"))
					.andThen(() =>
						this.clear(sources, {
							temp: false,
							backups: false,
							downloads: true,
						}),
					)
					.andThen(() => this._fetchSources(sources))
					.andThrough(() => this._pluginDriver.runHookSequential("onContentFetchDone"))
					.andThen(() =>
						ResultAsync.fromPromise(
							this._dataStore.close(),
							(e) => new ContentError("Failed to close data store", { cause: e }),
						),
					)
					.andTee(() => {
						// Update state and emit success event
						this._state.isFetching = false;
						this._state.lastFetchSuccess = new Date();
						this._eventBus?.emit("content:fetch:done", {
							sources: sources.map((s) => s.id),
							totalFiles: 0, // TODO: Track file count
							duration: Date.now() - this._startDatetime.getTime(),
						});
					})
					.orElse((e) => {
						this._pluginDriver.runHookSequential("onContentFetchError", e);
						this._logger.error("Error in content fetch process:", e);

						// Update state and emit error event
						this._state.isFetching = false;
						this._state.lastFetchError = new Date();
						this._eventBus?.emit("content:fetch:error", {
							error: e as Error,
						});

						if (backupAndRestore) {
							this._logger.info("Restoring from backup...");
							return this.restore(sources).andThen(() => {
								return err(
									new ContentError("Failed to download content. Restored from backup.", {
										cause: e,
									}),
								);
							});
						}
						return err(e);
					})
					.andTee(() =>
						this._logger.info("Content fetch complete. Clearing temp and backup directories."),
					)
					.andThen(() =>
						this.clear(sources, {
							temp: true,
							backups: backupAndRestore,
							downloads: false,
						}),
					);
			});
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
					.andThen((exists) => {
						if (!exists) {
							this._logger.warn(`No backup found for ${source.id}`);
							return ok(undefined);
						}

						this._logger.info(`Restoring ${chalk.white(source.id)} from backup`);

						return FileUtils.copy(backupPath, downloadPath, { preserveTimestamps: true }).andThen(
							() => {
								if (removeBackups) {
									this._logger.debug(`Removing backup for ${chalk.white(source.id)}`);
									return FileUtils.remove(backupPath);
								}
								return ok(undefined);
							},
						);
					})
					.mapErr(
						(e) =>
							new ContentError(`Failed to restore source ${chalk.white(source.id)}`, { cause: e }),
					);
			}),
		).map(() => undefined); // return void instead of void[]
	}

	getDownloadPath(sourceId?: string): string {
		if (sourceId) {
			return path.resolve(this._cwd, this._config.downloadPath, sourceId);
		}
		return path.resolve(this._cwd, this._config.downloadPath);
	}

	getTempPath(sourceId?: string, pluginName?: string): string {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.tempPath;
		let detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);

		if (pluginName) {
			detokenizedPath = path.resolve(this._cwd, detokenizedPath, pluginName);
		}

		if (sourceId) {
			detokenizedPath = path.resolve(this._cwd, detokenizedPath, sourceId);
		}

		return path.resolve(this._cwd, detokenizedPath);
	}

	getBackupPath(sourceId?: string): string {
		const downloadPath = this._config.downloadPath;
		const tokenizedPath = this._config.backupPath;
		const detokenizedPath = this._getDetokenizedPath(tokenizedPath, downloadPath);
		if (sourceId) {
			return path.resolve(path.resolve(this._cwd, detokenizedPath, sourceId));
		}
		return path.resolve(path.resolve(this._cwd, detokenizedPath));
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
		this._logger.info(
			`Fetching ${sources.length} source(s): ${sources.map((source) => source.id).join(", ")}`,
		);

		const fetchLogger = new FetchLogger(this._logger);

		return ResultAsync.combine(sources.map((source) => this._dataStore.createNamespace(source.id)))
			.andThen(() =>
				Result.combine(
					sources.map((source) => {
						// Emit source:start event
						this._eventBus?.emit("content:source:start", {
							sourceId: source.id,
							sourceType: (source as { type?: string }).type || "unknown",
						});

						return this._getSourceFetchPromises(source, fetchLogger);
					}),
				),
			)
			.andThen((fetchPromises) => {
				return ResultAsync.combine(fetchPromises.flat());
			})
			.andTee(() => {
				// Emit source:done events for each source
				for (const source of sources) {
					this._eventBus?.emit("content:source:done", {
						sourceId: source.id,
						documentCount: 0, // TODO: Track actual document count
					});
				}
				fetchLogger.close();
				this._logger.info("Fetch completed.");
			})
			.orElse((e) => {
				fetchLogger.close();
				this._logger.error("Fetch failed.");
				return err(e);
			})
			.map(() => undefined); // return void instead of void[];
	}

	_getSourceFetchPromises(source: ContentSource, fetchLogger: FetchLogger) {
		const sourceLogger = LogManager.getLogger(`source:${source.id}`, this._logger);

		const initializedFetch = source.fetch({
			logger: sourceLogger,
			dataStore: this._dataStore,
			abortSignal: this._abortController.signal,
		});

		const fetchAsArray = Array.isArray(initializedFetch) ? initializedFetch : [initializedFetch];

		return this._dataStore.namespace(source.id).andThen((namespace) => {
			const promises = fetchAsArray.map((req) => {
				const insertResultAsync = namespace
					.safeInsert(req.id, req.data)
					.andTee(() => {
						// Emit document:write event on success
						// Construct the file path (Documents don't expose their path)
						const filename = req.id.includes(".") ? req.id : `${req.id}.json`;
						const filePath = `${this.getDownloadPath(source.id)}/${filename}`;
						this._eventBus?.emit("content:document:write", {
							sourceId: source.id,
							documentId: req.id,
							path: filePath,
						});
					})
					.mapErr((e) => {
						// Emit document:error event on failure
						this._eventBus?.emit("content:document:error", {
							sourceId: source.id,
							documentId: req.id,
							error: e,
						});
						return new ContentError(`Failed to write data for ${req.id}`, e);
					});

				fetchLogger.addFetch(source.id, req.id, insertResultAsync);

				return insertResultAsync;
			});

			return ok(promises);
		});
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
		return path.join(innerTokenizedPath);
	}
}

export default LaunchpadContent;
