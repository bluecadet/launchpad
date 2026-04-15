import { SingleCommandGuard } from "@bluecadet/launchpad-utils/command-guard";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { type ContentCommand, contentCommandSchema } from "./content-commands.js";
import {
	type ContentConfig,
	parseContentConfig,
	type ResolvedContentConfig,
} from "./content-config.js";
import { contentPanel } from "./content-panel.js";
import { type ContentState, ContentStateManager } from "./content-state.js";
import { contentStatusSection } from "./content-status-section.js";
import { ContentError } from "./content-transform.js";
import {
	backupStage,
	cleanupStage,
	clearOldDataStage,
	errorRecoveryStage,
	type FetchStageContext,
	fetchSourcesStage,
	finalizingStage,
	runTransformsStage,
} from "./fetching/fetch-stages.js";
import type { ContentSource } from "./source.js";
import { DataStore } from "./utils/data-store.js";
import * as FileUtils from "./utils/file-utils.js";
import { createPathsHelper } from "./utils/paths-helper.js";

type ContentActionContext = PluginContext & {
	stateManager: ContentStateManager;
	sourceRegistry: Map<string, ContentSource>;
	resolvedConfig: ResolvedContentConfig;
};

function fetch(
	sourceIds: string[] | string | null,
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	const normalizedSourceIds = typeof sourceIds === "string" ? [sourceIds] : sourceIds;
	const idsToFetch = normalizedSourceIds || Array.from(ctx.sourceRegistry.keys());
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

	const context: FetchStageContext = {
		transforms: ctx.resolvedConfig.transforms,
		dataStore,
		logger: ctx.logger,
		eventBus: ctx.eventBus,
		config: ctx.resolvedConfig,
		cwd: ctx.cwd,
		abortSignal: ctx.abortSignal,
		paths,
		sources: resolvedSources,
	};

	// Execute the fetch pipeline
	for (const source of context.sources) {
		ctx.stateManager.markSourceFetching(source.id);
	}

	return (
		ctx.resolvedConfig.backupAndRestore
			? (() => {
					ctx.stateManager.setPhase({ phase: "backing-up" });
					return backupStage(context);
				})()
			: okAsync(undefined)
	)
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "clearing-old-data" });
			return clearOldDataStage(context);
		})
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "fetching-sources" });
			return fetchSourcesStage(context);
		})
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "running-transforms" });
			return runTransformsStage(context);
		})
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "finalizing", restored: false });
			return finalizingStage(context);
		})
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "clearing-temp" });
			for (const source of context.sources) {
				ctx.stateManager.markSourceSuccess(source.id);
			}
			return cleanupStage(context, {
				temp: true,
				backups: ctx.resolvedConfig.backupAndRestore,
			});
		})
		.andThen(() => {
			ctx.stateManager.setPhase({ phase: "idle" });
			return okAsync(undefined);
		})
		.orElse((error) => {
			// Error recovery path
			ctx.stateManager.setPhase({ phase: "error", error, restored: false });
			if (context.sources) {
				for (const source of context.sources) {
					ctx.stateManager.markSourceError(source.id, error);
				}
			}

			return errorRecoveryStage(context, error)
				.andThen(() => {
					if (context.sources) {
						for (const source of context.sources) {
							ctx.stateManager.markSourceRestored(source.id);
						}
					}
					ctx.stateManager.setPhase({ phase: "error", error, restored: true });
					return cleanupStage(context, {
						temp: true,
						backups: ctx.resolvedConfig.backupAndRestore,
					});
				})
				.andThen(() => {
					ctx.stateManager.setPhase({ phase: "clearing-temp" });
					return okAsync(undefined);
				})
				.andTee(() => {
					ctx.stateManager.setPhase({ phase: "idle" });
					dataStore._clear();
				})
				.orElse(() => {
					ctx.stateManager.setPhase({ phase: "idle" });
					dataStore._clear();
					return errAsync(error);
				})
				.andThen(() => {
					// Propagate original error after recovery
					return err(error);
				});
		});
}

function clear(
	sourceIds: string[] | string | null,
	{ temp = false, backups = false, downloads = true },
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	const normalizedSourceIds = typeof sourceIds === "string" ? [sourceIds] : sourceIds;
	const idsToClear = normalizedSourceIds || Array.from(ctx.sourceRegistry.keys());

	if (!idsToClear || idsToClear.length === 0) {
		ctx.logger.info("No sources to clear");
		return okAsync(undefined);
	}

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
		.map(() => undefined) // Map to void
		.mapErr((error) => new ContentError("Failed to clear directories", { cause: error }));
}

/**
 * Creates a LaunchpadContent plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function content(config: ContentConfig) {
	return definePlugin({
		name: "content",
		manifest: {
			commands: [
				{ id: "content.fetch", parser: contentCommandSchema },
				{ id: "content.clear", parser: contentCommandSchema },
				{ id: "content.backup", parser: contentCommandSchema },
				{ id: "content.restore", parser: contentCommandSchema },
			],
			lifecycle: {
				startupCommands: [{ type: "content.fetch" }],
			},
		},
		setup(ctx: PluginContext<ContentState>) {
			ctx.statusRegistry.contributeStatusSection(contentStatusSection);
			return parseContentConfig(config)
				.andTee((resolvedConfig) => {
					if (resolvedConfig.sources.length === 0) {
						ctx.logger.warn("No sources configured");
					}
				})
				.andThen((resolvedConfig) => {
					// initialize persistent services (services that live for the lifetime of the plugin, not per-command)

					const stateManager = new ContentStateManager(ctx.updateState);
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
					ctx.dashboardRegistry.contributePanel(contentPanel);
					if (sourceIds.length > 0) {
						ctx.logger.info(`Initialized ${sourceIds.length} source(s)`);
					}

					const actionContext = {
						...ctx,
						stateManager,
						sourceRegistry,
						resolvedConfig,
					};

					const commandGuard = new SingleCommandGuard();

					return ok({
						executeCommand(command: ContentCommand): ResultAsync<unknown, Error> {
							const parsed = contentCommandSchema.safeParse(command);
							if (!parsed.success) {
								return errAsync(new ContentError(`Invalid command: ${parsed.error.message}`));
							}

							const validCommand = parsed.data;

							switch (validCommand.type) {
								case "content.fetch": {
									return commandGuard.run(() => fetch(validCommand.sources ?? null, actionContext));
								}
								case "content.clear": {
									return commandGuard.run(() =>
										clear(
											validCommand.sources ?? null,
											{
												temp: validCommand.temp,
												backups: validCommand.backups,
												downloads: validCommand.downloads,
											},
											actionContext,
										),
									);
								}
								default: {
									return errAsync(
										new ContentError(`Unknown content command type: ${validCommand.type}`),
									);
								}
							}
						},
					});
				});
		},
	});
}
