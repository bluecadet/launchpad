import { SingleCommandGuard } from "@bluecadet/launchpad-utils/command-guard";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { writeAckLease } from "./acks.js";
import { type ContentCommand, contentCommandSchema } from "./content-commands.js";
import {
	type ContentConfig,
	parseContentConfig,
	type ResolvedContentConfig,
} from "./content-config.js";
import { type ContentState, ContentStateManager } from "./content-state.js";
import { buildContentSection } from "./content-summarize.js";
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
	sweepStage,
} from "./fetching/fetch-stages.js";
import { resolveOutputStrategy } from "./fetching/output-strategy.js";
import type { ContentSource } from "./source.js";
import { DataStore } from "./utils/data-store.js";
import * as FileUtils from "./utils/file-utils.js";
import { createPathsHelper } from "./utils/paths-helper.js";

function createFetchRunId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

	// Under versioning, promotion moves the whole staged root into a new version and rebuilds the
	// manifest from the fetched sources, so a subset fetch would silently drop every unfetched
	// source from the active version. Reject it rather than publish a version missing sources.
	if (normalizedSourceIds !== null && ctx.resolvedConfig.versioning) {
		return errAsync(
			new ContentError(
				"content.fetch with a sources filter is not supported when versioning is enabled",
			),
		);
	}

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

	const runId = createFetchRunId();
	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd, { runId });

	// Instantiate data store only when fetch is called
	const dataStore = new DataStore(paths.getStagedDownloadPath());

	const context: FetchStageContext = {
		transforms: ctx.resolvedConfig.transforms,
		dataStore,
		logger: ctx.logger,
		eventBus: ctx.eventBus,
		config: ctx.resolvedConfig,
		output: resolveOutputStrategy(ctx.resolvedConfig),
		cwd: ctx.cwd,
		abortSignal: ctx.abortSignal,
		runId,
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
			ctx.stateManager.setPhase({ phase: "sweeping-versions" });
			return sweepStage(context);
		})
		.andThen((sweepResult) => {
			if (sweepResult) {
				ctx.stateManager.recordSweep(sweepResult);
			}
			for (const source of context.sources) {
				ctx.stateManager.markSourceSuccess(source.id);
			}
			ctx.stateManager.setPhase({ phase: "clearing-temp" });
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
				.andThen(({ restoredSourceIds }) => {
					for (const sourceId of restoredSourceIds) {
						ctx.stateManager.markSourceRestored(sourceId);
					}
					ctx.stateManager.setPhase({
						phase: "error",
						error,
						restored: restoredSourceIds.length > 0,
					});
					ctx.stateManager.setPhase({ phase: "clearing-temp" });
					return cleanupStage(context, {
						temp: true,
						backups: ctx.resolvedConfig.backupAndRestore,
					});
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

	if (temp) {
		clearResults.push(
			FileUtils.clearDir(paths.getRunPath(), {
				removeIfEmpty: true,
			}),
		);
	}

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

/** See `writeAckLease` for the ack lease contract. Requires `versioning` to be enabled. */
function ack(
	consumerId: string,
	versionId: string,
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	if (!ctx.resolvedConfig.versioning) {
		return errAsync(new ContentError("content.ack requires versioning to be enabled"));
	}

	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);
	return writeAckLease(paths.getPublishedDownloadPath(), consumerId, versionId).mapErr(
		(error) => new ContentError(error.message, { cause: error }),
	);
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
				{ id: "content.ack", parser: contentCommandSchema },
			],
			cli: [
				{
					name: "content",
					description: "Content commands",
					subcommands: [
						{
							name: "fetch",
							description: "Fetch all content sources",
							commands: [{ type: "content.fetch" }],
							mode: "task",
						},
					],
				},
			],
		},
		summarize(state: LaunchpadState): Section | null {
			const contentState = state.plugins.content;
			if (!contentState) return null;
			return buildContentSection(contentState);
		},
		setup(ctx: PluginContext<ContentState>) {
			return parseContentConfig(config)
				.andTee((resolvedConfig) => {
					if (resolvedConfig.sources.length === 0) {
						ctx.logger.warn("No sources configured");
					}
				})
				.andThen((resolvedConfig) => {
					// initialize persistent services (services that live for the lifetime of the plugin, not per-command)

					const stateManager = new ContentStateManager(ctx.updateState);
					stateManager.setVersioning(
						resolvedConfig.versioning
							? { keepVersions: resolvedConfig.versioning.keepVersions }
							: false,
					);
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
								case "content.ack": {
									return ack(validCommand.consumerId, validCommand.versionId, actionContext);
								}
								case "content.backup":
								case "content.restore": {
									return errAsync(
										new ContentError(`Command '${validCommand.type}' is not yet implemented`),
									);
								}
								default: {
									validCommand satisfies never;
									return errAsync(new ContentError("Unreachable: unknown command type"));
								}
							}
						},
					});
				});
		},
	});
}
