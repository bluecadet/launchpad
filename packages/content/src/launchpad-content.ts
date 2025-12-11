import { PluginDriver } from "@bluecadet/launchpad-utils/plugin-driver";
import type { PatchHandler } from "@bluecadet/launchpad-utils/state-patcher";
import {
	type DashboardRegistry,
	defineSubsystem,
	type SubsystemContext,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { AnyCommand } from "@bluecadet/launchpad-utils/types";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import {
	type ContentConfig,
	parseContentConfig,
	type ResolvedContentConfig,
} from "./content-config.js";
import { registerContentDashboardFeatures } from "./content-dashboard.js";
import { ContentError, ContentPluginDriver } from "./content-plugin.js";
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
import type { ContentSource } from "./source.js";
import { DataStore } from "./utils/data-store.js";
import * as FileUtils from "./utils/file-utils.js";
import { createPathsHelper } from "./utils/paths-helper.js";
import "./content-commands.js";

type ContentActionContext = SubsystemContext & {
	stateManager: ContentStateManager;
	sourceRegistry: Map<string, ContentSource>;
	resolvedConfig: ResolvedContentConfig;
};

function fetch(sourceIds: string[] | null, ctx: ContentActionContext): ResultAsync<void, Error> {
	const idsToFetch = sourceIds || Array.from(ctx.sourceRegistry.keys());
	if (!idsToFetch || idsToFetch.length === 0) {
		ctx.logger.warn("No sources to fetch");
		return okAsync(undefined);
	}

	const missingSourceIds: string[] = [];
	const resolvedSources = idsToFetch
		.map((sourceId) => {
			const source = ctx.sourceRegistry.get(sourceId);
			if (!source) {
				missingSourceIds.push(sourceId);
			}
			return source;
		})
		.filter((source): source is ContentSource => source !== undefined);

	if (missingSourceIds.length > 0) {
		return errAsync(new ContentError(`Sources not registered: ${missingSourceIds.join(", ")}`));
	}

	ctx.eventBus.emit("content:fetch:start", {
		timestamp: new Date(),
	});

	// Instantiate data store only when fetch is called
	const dataStore = new DataStore(ctx.resolvedConfig.downloadPath);
	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);
	const basePluginDriver = new PluginDriver(ctx);
	const pluginDriver = new ContentPluginDriver(basePluginDriver, {
		dataStore: dataStore,
		options: ctx.resolvedConfig,
		eventBus: ctx.eventBus,
		paths,
	});
	pluginDriver.add(ctx.resolvedConfig.plugins);

	const context: FetchStageContext = {
		pluginDriver,
		dataStore,
		logger: ctx.logger,
		eventBus: ctx.eventBus,
		config: ctx.resolvedConfig,
		cwd: ctx.cwd,
		abortSignal: ctx.abortSignal,
		paths,
		sources: resolvedSources,
	};

	const startTime = new Date();

	// Execute the fetch pipeline

	ctx.stateManager.updateSourcesPhase(idsToFetch, { phase: "setup", startedAt: startTime });

	return setupHooksStage(context)
		.andThen((val) => {
			if (ctx.resolvedConfig.backupAndRestore) {
				ctx.stateManager.updateSourcesPhase(idsToFetch, { phase: "backup", startedAt: startTime });
				return backupStage(context);
			}
			return ok(val);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, { phase: "clearing", startedAt: startTime });
			return clearOldDataStage(context);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, { phase: "fetching", startedAt: startTime });
			return fetchSourcesStage(context);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, {
				phase: "transforming",
				startedAt: startTime,
			});
			return doneHooksStage(context);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, {
				phase: "finalizing",
				startedAt: startTime,
			});
			return finalizingStage(context);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, {
				phase: "cleanup",
				startedAt: startTime,
			});
			return cleanupStage(context, {
				temp: true,
				backups: ctx.resolvedConfig.backupAndRestore,
			});
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToFetch, {
				phase: "done",
				finishedAt: startTime,
				duration: Date.now() - startTime.getTime(),
			});
			return okAsync(undefined);
		})
		.orElse((error) => {
			// Error recovery path
			ctx.stateManager.updateSourcesPhase(idsToFetch, {
				phase: "error",
				error,
				attemptedAt: startTime,
				restored: false,
			});

			return errorRecoveryStage(context, error)
				.andThen(() => {
					ctx.stateManager.updateSourcesPhase(idsToFetch, {
						phase: "error",
						error,
						attemptedAt: startTime,
						restored: true,
					});
					return cleanupStage(context, {
						temp: true,
						backups: ctx.resolvedConfig.backupAndRestore,
					});
				})
				.andThen(() => {
					dataStore._clear();
					// Propagate original error after recovery
					return err(error);
				})
				.orElse(() => {
					dataStore._clear();
					return errAsync(error);
				});
		});
}

function clear(
	sourceIds: string[] | null,
	{ temp = false, backups = false, downloads = true },
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	const idsToClear = sourceIds || Array.from(ctx.sourceRegistry.keys());

	if (!idsToClear || idsToClear.length === 0) {
		ctx.logger.info("No sources to clear");
		return okAsync(undefined);
	}

	const startTime = new Date();

	ctx.stateManager.updateSourcesPhase(idsToClear, { phase: "clearing", startedAt: startTime });

	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);

	const clearResults: ResultAsync<void, ContentError>[] = [];

	for (const sourceId of idsToClear) {
		if (temp) {
			clearResults.push(
				FileUtils.clearDir(paths.getTempPath(sourceId), {
					removeIfEmpty: true,
				}),
			);
		}
		if (backups) {
			clearResults.push(
				FileUtils.clearDir(paths.getBackupPath(sourceId), {
					removeIfEmpty: true,
				}),
			);
		}
		if (downloads) {
			clearResults.push(
				FileUtils.clearDir(paths.getDownloadPath(sourceId), {
					removeIfEmpty: true,
				}),
			);
		}
	}

	return ResultAsync.combine(clearResults)
		.andThen(() => {
			// Also remove the containing directories (without the source subdir) if they are empty after clearing
			// e.g. .tmp/, .backup/, .downloads/
			const clearTopResults = [];

			if (temp) {
				clearTopResults.push(FileUtils.removeDirIfEmpty(paths.getTempPath()));
			}
			if (backups) {
				clearTopResults.push(FileUtils.removeDirIfEmpty(paths.getBackupPath()));
			}
			if (downloads) {
				clearTopResults.push(FileUtils.removeDirIfEmpty(paths.getDownloadPath()));
			}

			if (clearTopResults.length === 0) {
				return okAsync(undefined);
			}

			return ResultAsync.combine(clearTopResults);
		})
		.andThen(() => {
			ctx.stateManager.updateSourcesPhase(idsToClear, {
				phase: "idle",
			});
			return okAsync(undefined);
		})
		.map(() => undefined) // Map to void
		.mapErr((error) => new ContentError("Failed to clear directories", { cause: error }));
}

function _validateSourcesAreIdle(
	sourceIds: string[] | null,
	ctx: ContentActionContext,
): Result<void, Error> {
	const idsToCheck = sourceIds || Array.from(ctx.sourceRegistry.keys());
	const currentState = ctx.stateManager.state;

	const busySources: string[] = [];

	for (const sourceId of idsToCheck) {
		const sourceState = currentState.sources[sourceId];
		if (!sourceState) {
			return err(new ContentError(`Source ID not found in state: ${sourceId}`));
		}
		if (["idle", "done", "error"].indexOf(sourceState.phase) === -1) {
			busySources.push(sourceId);
		}
	}

	if (busySources.length > 0) {
		return err(
			new ContentError(`Cannot perform action. Sources not idle: ${busySources.join(", ")}`),
		);
	}

	return ok(undefined);
}

/**
 * Creates a LaunchpadContent subsystem factory.
 * Call setup() on the returned object to initialize the content system.
 */
export function createLaunchpadContent(config: ContentConfig) {
	return defineSubsystem({
		name: "content",
		setup(ctx: SubsystemContext) {
			return parseContentConfig(config)
				.andTee((resolvedConfig) => {
					if (resolvedConfig.sources.length === 0) {
						ctx.logger.warn("No sources configured");
					}
				})
				.andThen((resolvedConfig) => {
					// initialize persistent services (services that live for the lifetime of the subsystem, not per-command)

					const stateManager = new ContentStateManager();
					const sourceRegistry = new Map<string, ContentSource>();

					// Check for duplicates
					for (const source of resolvedConfig.sources) {
						if (sourceRegistry.has(source.id)) {
							return err(new ContentError(`Duplicate source ID detected: ${source.id}`));
						}
						sourceRegistry.set(source.id, source);
					}

					const sourceIds = resolvedConfig.sources.map((s) => s.id);
					stateManager.initializeSources(sourceIds);
					if (sourceIds.length > 0) {
						ctx.logger.info(`Initialized ${sourceIds.length} source(s)`);
					}

					const actionContext = {
						...ctx,
						stateManager,
						sourceRegistry,
						resolvedConfig,
					};

					return ok({
						executeCommand(command: AnyCommand): ResultAsync<unknown, Error> {
							switch (command.type) {
								case "content.fetch": {
									return _validateSourcesAreIdle(
										command.sources ?? null,
										actionContext,
									).asyncAndThen(() => fetch(command.sources ?? null, actionContext));
								}
								case "content.clear": {
									return _validateSourcesAreIdle(
										command.sources ?? null,
										actionContext,
									).asyncAndThen(() =>
										clear(
											command.sources ?? null,
											{
												temp: command.temp,
												backups: command.backups,
												downloads: command.downloads,
											},
											actionContext,
										),
									);
								}
								default: {
									return errAsync(
										new ContentError(
											`Unknown content command type: ${(command as AnyCommand).type}`,
										),
									);
								}
							}
						},
						getState(): ContentState {
							return stateManager.state;
						},
						onStatePatch(handler: PatchHandler): () => void {
							return stateManager.onPatch(handler);
						},
						buildDashboard(registry: DashboardRegistry) {
							return registerContentDashboardFeatures(registry, stateManager);
						},
					});
				});
		},
	});
}
