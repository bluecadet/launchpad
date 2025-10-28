import path from "node:path";
import {
	type CommandExecutor,
	type EventBus,
	type EventBusAware,
	type Logger,
	LogManager,
	onExit,
	type PatchHandler,
	PluginDriver,
	type StateProvider,
} from "@bluecadet/launchpad-utils";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import type { ContentCommand } from "./content-commands.js";
import {
	type ContentConfig,
	contentConfigSchema,
	DOWNLOAD_PATH_TOKEN,
	type ResolvedContentConfig,
	TIMESTAMP_TOKEN,
} from "./content-config.js";
import { ContentError, ContentPluginDriver } from "./content-plugin-driver.js";
import { type ContentState, ContentStateManager } from "./content-state.js";
import {
	backupStage,
	cleanupStage,
	clearOldDataStage,
	doneHooksStage,
	errorRecoveryStage,
	type FetchStageContext,
	fetchSourcesStage,
	finalizingStage,
	setupHooksStage,
} from "./fetching/fetch-stages.js";
import type { ContentSource } from "./sources/source.js";
import { DataStore } from "./utils/data-store.js";
import * as FileUtils from "./utils/file-utils.js";

class LaunchpadContent
	implements EventBusAware, CommandExecutor<ContentCommand>, StateProvider<ContentState>
{
	private _config: ResolvedContentConfig;
	private _logger: Logger;
	private _pluginDriver: ContentPluginDriver;
	private _sourceRegistry: Map<string, ContentSource> = new Map();
	private _startDatetime = new Date();
	private _abortController = new AbortController();
	private _cwd: string;
	private _eventBus?: EventBus;
	private _commandInProgress = false;
	private _initialized = false;
	// TODO: Consider making DataStore per-fetch instead of per-instance
	private _dataStore: DataStore;
	private _stateManager: ContentStateManager;

	constructor(config: ContentConfig, parentLogger: Logger, cwd = process.cwd()) {
		this._config = contentConfigSchema.parse(config);
		this._cwd = cwd;
		this._logger = LogManager.getLogger("content", parentLogger);
		this._dataStore = new DataStore(this._config.downloadPath);
		this._stateManager = new ContentStateManager();

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
	 * Shorthand to create the LaunchpadContent instance and load sources.
	 * Returns a ResultAsync that resolves to the initialized instance.
	 */
	static init(
		...args: ConstructorParameters<typeof LaunchpadContent>
	): ResultAsync<LaunchpadContent, ContentError> {
		const instance = new LaunchpadContent(...args);
		return instance.loadSources().map(() => instance);
	}

	/**
	 * Initialize the content system with sources.
	 * Must be called before fetch/clear operations.
	 * Sources are registered and resolved here.
	 */
	loadSources(): ResultAsync<void, ContentError> {
		const inputSources = this._config.sources;

		if (!inputSources || inputSources.length === 0) {
			this._logger.warn("No sources configured");
			return okAsync(undefined);
		}

		// Resolve any promise-based sources
		return ResultAsync.fromPromise(
			Promise.all(inputSources.map((s) => Promise.resolve(s))),
			(error) => new ContentError("Failed to resolve sources", { cause: error }),
		)
			.andThen((resolvedSources) => {
				// Register sources in the registry
				for (const source of resolvedSources) {
					if (this._sourceRegistry.has(source.id)) {
						return err(
							new ContentError(`Duplicate source ID detected during loadSources: ${source.id}`),
						);
					}
					this._sourceRegistry.set(source.id, source);
				}

				// Initialize source states
				const sourceIds = resolvedSources.map((s) => s.id);
				this._stateManager.initializeSources(sourceIds);
				this._initialized = true;

				this._logger.info(`Initialized ${sourceIds.length} source(s)`);
				return ok(undefined);
			})
			.orElse((e) => {
				this._pluginDriver.runHookSequential("onSetupError", e);
				return err(e);
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
	 * Get immutable snapshot of the current state of the content system.
	 */
	getState(): ContentState {
		return this._stateManager.state;
	}

	onStatePatch(handler: PatchHandler): () => void {
		return this._stateManager.onPatch(handler);
	}

	/**
	 * Execute a command on the content subsystem.
	 * This is called by the controller's CommandDispatcher.
	 */
	executeCommand(command: ContentCommand): ResultAsync<unknown, Error> {
		switch (command.type) {
			case "content.fetch": {
				// Fetch uses sourceIds from command, or all registered sources
				return this._singleCommandGuard(() =>
					this.start(command.sources).mapErr((e) => e as Error),
				);
			}

			case "content.clear": {
				return this._singleCommandGuard(() =>
					this.clear(command.sources, {
						temp: command.temp ?? true,
						backups: command.backups ?? true,
						downloads: command.downloads ?? true,
					}).mapErr((e) => e as Error),
				);
			}

			default: {
				return ResultAsync.fromSafePromise(
					Promise.reject(
						new Error(`Unknown content command type: ${(command as ContentCommand).type}`),
					),
				);
			}
		}
	}

	private _singleCommandGuard<T, E>(
		action: () => ResultAsync<T, E>,
	): ResultAsync<T, E | ContentError> {
		if (this._commandInProgress) {
			return errAsync(
				new ContentError(
					"A content command is already in progress. Please wait for it to complete.",
				),
			);
		}

		this._commandInProgress = true;

		// regardless of success or failure, clear the in-progress flag
		return action()
			.andTee(() => {
				this._commandInProgress = false;
			})
			.orTee(() => {
				this._commandInProgress = false;
			});
	}

	/**
	 * Fetch content from the specified sources.
	 * Sources must be registered via loadSources() first.
	 *
	 * @param sourceIds - Source IDs to fetch from. If not specified, fetches all registered sources.
	 */
	start(sourceIds?: Array<string> | null): ResultAsync<void, ContentError> {
		if (!this._initialized) {
			return errAsync(
				new ContentError(
					"Content system not initialized. Call loadSources() first or use the static init() method.",
				),
			);
		}

		const idsToFetch = sourceIds || this._sourceRegistry.keys();
		if (!idsToFetch) {
			this._logger.warn("No sources to fetch");
			return okAsync(undefined);
		}

		// Reset state at the start of a new fetch
		this._stateManager.setPhase({ phase: "idle" });

		const resolvedSources: ContentSource[] = [];

		for (const sourceId of idsToFetch) {
			const source = this._sourceRegistry.get(sourceId);
			if (source) {
				resolvedSources.push(source);
			} else {
				this._logger.error(
					`Source not registered with ID: ${sourceId}. Did you forget to call loadSources()?`,
				);
				return errAsync(new ContentError(`Source not registered with ID: ${sourceId}`));
			}
		}

		this._startDatetime = new Date();

		// Emit fetch start event
		this._eventBus?.emit("content:fetch:start", { timestamp: this._startDatetime });

		// Create fetch stage context with fresh DataStore
		const context: FetchStageContext = {
			pluginDriver: this._pluginDriver,
			dataStore: this._dataStore,
			logger: this._logger,
			eventBus: this._eventBus,
			config: this._config,
			cwd: this._cwd,
			abortSignal: this._abortController.signal,
			getDownloadPath: this.getDownloadPath.bind(this),
			getTempPath: this.getTempPath.bind(this),
			getBackupPath: this.getBackupPath.bind(this),
			sources: resolvedSources,
		};

		// Execute fetch pipeline with resolved sources
		return this._executeFetchPipeline(context);
	}

	/**
	 * Alias for start()
	 */
	download(sourceIds?: string[] | null): ResultAsync<void, ContentError> {
		return this.start(sourceIds);
	}

	/**
	 * Clears all cached content except for files that match config.keep.
	 * @param sourceIds - Source IDs to clear. If not specified, clears all registered sources.
	 */
	clear(
		sourceIds?: string[] | null,
		{ temp = true, backups = true, downloads = true, removeIfEmpty = true } = {},
	): ResultAsync<void, ContentError> {
		const idsToClear = sourceIds || Array.from(this._sourceRegistry.keys());

		if (!idsToClear || idsToClear.length === 0) {
			this._logger.info("No sources to clear");
			return okAsync(undefined);
		}

		return ResultAsync.combine(
			idsToClear.map((sourceId) => {
				const tasks = [] as ResultAsync<void, ContentError>[];
				if (temp) {
					tasks.push(
						FileUtils.clearDir(this.getTempPath(sourceId), { removeIfEmpty, ignoreKeep: true }),
					);
				}
				if (backups) {
					tasks.push(
						FileUtils.clearDir(this.getBackupPath(sourceId), { removeIfEmpty, ignoreKeep: true }),
					);
				}
				if (downloads) {
					tasks.push(
						FileUtils.clearDir(this.getDownloadPath(sourceId), {
							removeIfEmpty,
							keepPatterns: this._config.keep,
						}),
					);
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
			.map(() => undefined)
			.mapErr((error) => new ContentError("Failed to clear directories", { cause: error }));
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

	/**
	 * Execute the fetch pipeline with already-resolved sources.
	 * Pipeline manages state transitions between stages.
	 */
	private _executeFetchPipeline(context: FetchStageContext): ResultAsync<void, ContentError> {
		// Initialize sources to fetching state
		for (const source of context.sources) {
			this._stateManager.markSourceFetching(source.id);
		}

		this._stateManager.setPhase({ phase: "running-setup-hooks" });

		// Pipeline stages with state management
		return (
			// Stage 1: Setup hooks
			setupHooksStage(context)
				.andThen((val) => {
					if (this._config.backupAndRestore) {
						this._stateManager.setPhase({ phase: "backing-up" });
						// Stage 2: Backup (optional)
						return backupStage(context);
					}

					return ok(val);
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "clearing-old-data" });
					// Stage 3: Clear old data
					return clearOldDataStage(context);
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "fetching-sources" });
					// Stage 4: Fetch sources
					return fetchSourcesStage(context);
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "running-done-hooks" });
					// Stage 5: Done hooks
					return doneHooksStage(context);
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "finalizing", restored: false });
					// Stage 6: Finalize
					return finalizingStage(context);
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "clearing-temp" });
					// Mark all sources as success
					for (const source of context.sources) {
						this._stateManager.markSourceSuccess(source.id);
					}
					// Stage 7: Cleanup temp and backups
					return cleanupStage(context, {
						temp: true,
						backups: this._config.backupAndRestore,
					});
				})
				.andThen(() => {
					this._stateManager.setPhase({ phase: "idle" });
					return okAsync(undefined);
				})
				.andTee(() => {
					// Clear data store
					context.dataStore._clear();
				})
				.orElse((error) => {
					// Run error recovery
					context.dataStore._clear();
					return this._runErrorRecovery(context, error).andThen(() => {
						// Propagate original error after recovery
						return err(error);
					});
				})
		);
	}

	/**
	 * Run error recovery and cleanup after fetch failure.
	 */
	private _runErrorRecovery(
		context: FetchStageContext,
		error: ContentError,
	): ResultAsync<void, ContentError> {
		this._stateManager.setPhase({ phase: "error", error, restored: false });
		// Mark sources as failed
		if (context.sources) {
			for (const source of context.sources) {
				this._stateManager.markSourceError(source.id, error);
			}
		}

		return errorRecoveryStage(context, error)
			.andThen(() => {
				// Mark sources as restored
				if (context.sources) {
					for (const source of context.sources) {
						this._stateManager.markSourceRestored(source.id);
					}
				}
				this._stateManager.setPhase({ phase: "error", error, restored: true });
				// Cleanup even on error
				return cleanupStage(context, {
					temp: true,
					backups: this._config.backupAndRestore,
				});
			})
			.andThen(() => {
				this._stateManager.setPhase({ phase: "clearing-temp" });
				return okAsync(undefined);
			})
			.andTee(() => {
				this._stateManager.setPhase({ phase: "idle" });
				// Cleanup the dataStore
				context.dataStore._clear();
			})
			.orElse(() => {
				// Even if recovery fails, cleanup temp and reset
				this._stateManager.setPhase({ phase: "idle" });
				context.dataStore._clear();
				return errAsync(error);
			});
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
