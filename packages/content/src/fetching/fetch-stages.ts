/**
 * Fetch pipeline stages as simple functions.
 * Each stage is responsible for one phase of the fetch lifecycle.
 *
 * Stages are composed in LaunchpadContent._executeFetchPipeline.
 */

import { ensureError } from "@bluecadet/launchpad-utils/errors";
import chalk from "chalk";
import { err, errAsync, okAsync, ResultAsync } from "neverthrow";
import {
	ContentError,
	type ContentTransform,
	type ContentTransformContext,
} from "../content-transform.js";
import type { Manifest } from "../manifest.js";
import type { SweepResult } from "../retention-sweep.js";
import type { ContentSource } from "../source.js";
import { FetchLogger } from "../utils/fetch-logger.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";

function prepareStagedSourceDirectory(
	context: FetchStageContext,
	sourceId: string,
	activeManifest: Manifest | undefined,
): ResultAsync<void, ContentError> {
	const stagedPath = context.paths.getStagedDownloadPath(sourceId);

	return context.output
		.resolveSeedPath(context, sourceId, activeManifest)
		.andThen((seedPath) =>
			FileUtils.clearDir(stagedPath, {
				ignoreKeep: true,
				removeIfEmpty: true,
			})
				.andThen(() => FileUtils.ensureDir(stagedPath))
				.andThen(() =>
					seedPath
						? FileUtils.copyMatchingFiles(seedPath, stagedPath, context.config.keep)
						: okAsync(undefined),
				),
		)
		.mapErr(
			(error) =>
				new ContentError(`Failed to prepare staged directory for ${sourceId}`, { cause: error }),
		);
}

export type { FetchStageContext } from "./fetch-context.js";

/**
 * Error thrown during fetching of a specific source.
 */
export class ContentFetchError extends ContentError {
	constructor(
		message: string,
		public sourceId: string,
		cause?: Error,
	) {
		super(message, { cause });
		this.name = "ContentFetchError";
	}
}

/**
 * Error thrown during recovery process.
 */
export class ContentRecoveryError extends ContentError {
	constructor(
		message: string,
		public originalError: ContentError,
		cause?: Error,
	) {
		super(message, { cause });
		this.name = "ContentRecoveryError";
	}
}

/**
 * Stage 2: Back up existing downloads (optional).
 */
export function backupStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	// Silently skipped when the output strategy supersedes backups (see
	// `OutputStrategy.backupsSupported`), since `backupAndRestore` defaults to true and a
	// warning would fire for every versioned config.
	const backupRequired = context.config.backupAndRestore && context.output.backupsSupported;
	if (!backupRequired) {
		return okAsync(undefined);
	}

	context.logger.debug("Beginning phase: backing-up");

	context.logger.info("Backing up downloads...");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	return ResultAsync.combine(
		context.sources.map((source) => {
			const downloadPath = context.paths.getPublishedDownloadPath(source.id);
			const backupPath = context.paths.getBackupPath(source.id);

			return FileUtils.pathExists(downloadPath)
				.andThen((exists) => {
					if (!exists) {
						context.logger.warn(
							`Skipping backup for ${source.id}: No downloads found at ${downloadPath}`,
						);
						return okAsync(undefined);
					}

					context.logger.info(`Backing up source: ${source.id}`);
					return FileUtils.copy(downloadPath, backupPath);
				})
				.mapErr((e) => new ContentError("Failed to backup sources", { cause: e }));
		}),
	).map(() => undefined);
}

/**
 * Stage 3: Clear old downloads.
 */
export function clearOldDataStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: clearing-old-data");

	context.logger.info("Preparing staged download directory");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	return context.output
		.readSeedManifest(context)
		.andThen((manifest) =>
			ResultAsync.combine(
				context.sources.map((source) => prepareStagedSourceDirectory(context, source.id, manifest)),
			).map(() => undefined),
		);
}

/**
 * Stage 4: Fetch all sources in parallel.
 */
export function fetchSourcesStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: fetching-sources");

	if (!context.sources || context.sources.length === 0) {
		context.logger.warn("No sources found to download");
		return okAsync(undefined);
	}

	context.logger.info("Beginning content fetch process");
	context.logger.info(
		`Fetching ${context.sources.length} source(s): ${context.sources.map((s) => s.id).join(", ")}`,
	);

	const fetchLogger = new FetchLogger(context.logger, context.eventBus);

	return ResultAsync.combine(
		// eagerly instantiate all namespaces, that way a source can depend on another source's data
		// with the Namespace.waitFor API
		context.sources.map((source) => context.dataStore.createNamespace(source.id)),
	).andThen(
		() =>
			ResultAsync.combine(
				context.sources.map((source) =>
					_fetchSource(source, context, fetchLogger).mapErr((e) => {
						const error = new ContentFetchError(
							`Failed to fetch source ${source.id}`,
							source.id,
							e,
						);
						context.eventBus?.emit("content:source:error", { sourceId: source.id, error });
						return error;
					}),
				),
			)
				.andTee(() => {
					fetchLogger.close();
					context.logger.info("Fetch completed.");

					// Emit fetch:done event for each successful fetch
					for (const source of context.sources) {
						context.eventBus?.emit("content:source:done", {
							sourceId: source.id,
						});
					}
				})
				.orTee(() => {
					// On error, still close the logger
					fetchLogger.close();
				})
				.map(() => undefined), // return void
	);
}

function _fetchSource(source: ContentSource, context: FetchStageContext, fetchLogger: FetchLogger) {
	context.eventBus?.emit("content:source:start", {
		sourceId: source.id,
		sourceType: (source as { type?: string }).type || "unknown",
	});

	return context.dataStore.namespace(source.id).asyncAndThen((namespace) => {
		const fetchResult = source.fetch(context);
		const fetchArray = Array.isArray(fetchResult) ? fetchResult : [fetchResult];

		const insertResults = fetchArray.map((req) => {
			const insertResultAsync = namespace
				.insert(req.id, req.data)
				.andTee(() => {
					// Emit document:write event on success
					// Construct the file path (Documents don't expose their path)
					const filename = req.id.includes(".") ? req.id : `${req.id}.json`;
					const filePath = `${context.paths.getStagedDownloadPath(source.id)}/${filename}`;
					context.eventBus?.emit("content:document:write", {
						sourceId: source.id,
						documentId: req.id,
						path: filePath,
					});
				})
				.mapErr((e) => {
					// Emit document:error event on failure
					context.eventBus?.emit("content:document:error", {
						sourceId: source.id,
						documentId: req.id,
						error: e,
					});
					return new ContentError(`Failed to write data for ${req.id}`, e);
				});

			fetchLogger.addFetch(source.id, req.id, insertResultAsync);

			return insertResultAsync;
		});

		return ResultAsync.combine(insertResults);
	});
}

/**
 * Stage 5: Run content transforms sequentially.
 * Each transform's temp path is namespaced to the transform name.
 */
export function runTransformsStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	if (context.transforms.length === 0) {
		return okAsync(undefined);
	}

	context.logger.debug("Beginning phase: running-transforms");

	const baseCtx = {
		data: context.dataStore,
		logger: context.logger,
		contentOptions: context.config,
		eventBus: context.eventBus,
		abortSignal: context.abortSignal,
		cwd: context.cwd,
	};

	return context.transforms.reduce(
		(chain: ResultAsync<void, ContentError>, transform: ContentTransform) =>
			chain.andThen(() => {
				const startTime = Date.now();
				context.eventBus.emit("content:transform:start", { transformName: transform.name });

				const transformCtx: ContentTransformContext = {
					...baseCtx,
					paths: {
						...context.paths,
						// Bind transform.name into getTempPath for namespace isolation
						getTempPath: (source?: string) => context.paths.getTempPath(source, transform.name),
					},
				};

				return ResultAsync.fromPromise(
					transform.apply(transformCtx),
					(e) =>
						new ContentError(`Transform "${transform.name}" failed`, {
							cause: ensureError(e),
						}),
				)
					.andTee(() => {
						context.eventBus.emit("content:transform:done", {
							transformName: transform.name,
							duration: Date.now() - startTime,
						});
					})
					.orElse((error) => {
						context.eventBus.emit("content:transform:error", {
							transformName: transform.name,
							error,
						});
						return err(error);
					});
			}),
		okAsync<void, ContentError>(undefined),
	);
}

/**
 * Stage 6: Finalize (success path).
 */
export function finalizingStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: finalizing");

	return context.dataStore
		.close()
		.mapErr((e) => new ContentError("Failed to close data store", { cause: e }))
		.andThen(() => {
			if (!context.sources) {
				return okAsync(undefined);
			}

			return context.output.promote(context);
		})
		.andTee(() => {
			context.eventBus?.emit("content:fetch:done", {
				sources: context.sources?.map((s) => s.id) || [],
			});
		});
}

/**
 * Stage 6 (Versioned only): keep-N retention sweep of `versions/`, run once per successful
 * versioned fetch. A no-op (resolves `undefined`) with versioning off. Never fails the fetch:
 * a version dir that can't be fully removed is left in place and reported as pending-delete,
 * to be retried on the next sweep.
 */
export function sweepStage(
	context: FetchStageContext,
): ResultAsync<SweepResult | undefined, never> {
	context.logger.debug("Beginning phase: sweeping-versions");

	return context.output.sweep(context);
}

/**
 * Stage 7: Handle errors and optionally restore from backup.
 */
export const errorRecoveryStage = (
	context: FetchStageContext,
	error: ContentError,
): ResultAsync<{ restoredSourceIds: string[] }, ContentError | ContentRecoveryError> => {
	context.logger.debug("Beginning phase: error-recovery");
	context.logger.error("Error in content fetch process. Running recovery steps...");

	context.eventBus?.emit("content:fetch:error", { error });

	// The strategy first cleans up this run's partial output (a no-op for flat output, a
	// best-effort orphaned-version delete under versioning), then backup restore runs only
	// when both the config asks for it and the strategy supports it.
	const restoreRequired = context.config.backupAndRestore && context.output.backupsSupported;

	return context.output.cleanupFailedRun(context).andThen(() => {
		if (!restoreRequired) {
			return okAsync({ restoredSourceIds: [] });
		}

		context.logger.info("Restoring from backup...");
		return restoreSourcesFromBackup(context, error);
	});
};

function restoreSourcesFromBackup(
	context: FetchStageContext,
	error: ContentError,
): ResultAsync<{ restoredSourceIds: string[] }, ContentRecoveryError> {
	return ResultAsync.combine(
		context.sources.map((source) => {
			const downloadPath = context.paths.getPublishedDownloadPath(source.id);
			const backupPath = context.paths.getBackupPath(source.id);

			return FileUtils.pathExists(backupPath)
				.andThen((exists) => {
					if (!exists) {
						context.logger.warn(`No backup found for ${source.id}`);
						return okAsync<string | undefined>(undefined);
					}

					context.logger.info(`Restoring ${chalk.white(source.id)} from backup`);
					return FileUtils.remove(downloadPath)
						.andThen(() =>
							FileUtils.copy(backupPath, downloadPath, {
								preserveTimestamps: true,
							}),
						)
						.map(() => source.id)
						.mapErr((e) => new ContentRecoveryError(`Failed to restore ${source.id}`, error, e));
				})
				.mapErr((e) => new ContentRecoveryError(`Restore failed for ${source.id}`, error, e));
		}),
	).map((restoredSourceIds) => ({
		restoredSourceIds: restoredSourceIds.filter(
			(sourceId): sourceId is string => sourceId !== undefined,
		),
	}));
}

/**
 * Stage 7 (Final): Clean up temporary and backup directories.
 */
export const cleanupStage = (
	context: FetchStageContext,
	cleanup: { temp?: boolean; backups?: boolean } = {},
): ResultAsync<void, ContentError> => {
	context.logger.debug("Beginning phase: clearing-temp");

	if (!context.sources) {
		return okAsync(undefined);
	}

	const dirPaths: string[] = [];

	if (cleanup.temp) {
		dirPaths.push(context.paths.getRunPath());
	}

	if (cleanup.backups) {
		dirPaths.push(...context.sources.map((source) => context.paths.getBackupPath(source.id)));
	}

	if (dirPaths.length === 0) {
		return okAsync(undefined);
	}

	return ResultAsync.combine(
		dirPaths.map((dirPath) =>
			FileUtils.clearDir(dirPath, {
				keepPatterns: undefined,
				ignoreKeep: true,
				removeIfEmpty: true,
			}),
		),
	).map(() => undefined);
};
