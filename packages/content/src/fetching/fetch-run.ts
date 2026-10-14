import { err, errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ArtifactCache } from "../cache/artifact-cache.js";
import type { ContentActionContext } from "../content-action-context.js";
import { ContentError } from "../content-transform.js";
import type { ContentSource } from "../source.js";
import { DataStore } from "../utils/data-store.js";
import { createPathsHelper, type PathsHelper } from "../utils/paths-helper.js";
import { closeRunCache, commitCachePublication, openRunCache } from "./cache-lifecycle.js";
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
} from "./fetch-stages.js";
import { resolveOutputStrategy } from "./output-strategy.js";

function createFetchRunId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function fetchContent(
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

	let context: FetchStageContext | undefined;
	return ResultAsync.fromPromise(
		(async () => {
			const cache = await openRunCache(
				ctx.cwd,
				ctx.logger,
				(sourceId) => context?.seedRoots.get(sourceId),
				(sourceId) => {
					if (!resolvedSources.some((source) => source.id === sourceId)) {
						throw new ContentError(`Source not fetched in this run: ${sourceId}`);
					}
					return paths.getStagedDownloadPath(sourceId);
				},
			);
			try {
				context = createRunContext(ctx, resolvedSources, runId, paths, cache);
				return await fetchRun(ctx, context);
			} finally {
				await closeRunCache(cache, ctx.logger);
			}
		})(),
		(error) => new ContentError("Failed to initialize content fetch", { cause: error }),
	).andThen((result) => result);
}

function createRunContext(
	ctx: ContentActionContext,
	resolvedSources: ContentSource[],
	runId: string,
	paths: PathsHelper,
	cache: ArtifactCache,
): FetchStageContext {
	// Instantiate data store only when fetch is called
	const dataStore = new DataStore(paths.getStagedDownloadPath());

	return {
		cache,
		seedRoots: new Map(),
		publication: { status: "preparing" },
		dataStoreClosed: false,
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
}

function fetchRun(ctx: ContentActionContext, context: FetchStageContext): ResultAsync<void, Error> {
	const dataStore = context.dataStore;
	// Execute the fetch pipeline
	for (const source of context.sources) {
		ctx.stateManager.markSourceFetching(source.id);
	}

	if (context.config.backupAndRestore && context.output.backupsSupported) {
		ctx.stateManager.setPhase({ phase: "backing-up" });
	}
	return backupStage(context)
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
			return cleanupStage(context, { temp: true });
		})
		.andThen(() => cleanupStage(context, { backups: ctx.resolvedConfig.backupAndRestore }))
		.andThen(() => ResultAsync.fromSafePromise(commitCachePublication(context)))
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

			return ResultAsync.fromSafePromise(context.cache.abort())
				.andThen(() =>
					context.dataStoreClosed
						? okAsync(undefined)
						: dataStore.close().orElse((closeError) => {
								ctx.logger.warn("Failed to close content data store during recovery", closeError);
								return okAsync(undefined);
							}),
				)
				.andThen(() => errorRecoveryStage(context, error))
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
				.orElse((recoveryError) => {
					ctx.logger.warn(
						"Recovery failed; retaining run files and backups for manual recovery",
						recoveryError,
					);
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
